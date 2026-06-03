import asyncio
import ssl
import sys
import os
import argparse
import subprocess
import logging

from securetunnel.common import (
    pad_data, read_padded_data,
    CMD_CONNECT, CMD_CONNECT_OK, CMD_CONNECT_FAIL, CMD_DATA, CMD_CLOSE, CMD_KEEPALIVE,
    STMPConnection, read_stmp_frame
)

# Configure logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("securetunnel-relay")

def generate_self_signed_cert(cert_path="cert.pem", key_path="key.pem"):
    logger.info(f"Self-signed certificate is missing. Generating default Certificate Keypair...")
    try:
        cmd = [
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", key_path, "-out", cert_path,
            "-sha256", "-days", "365", "-nodes",
            "-subj", "/CN=SecureTunnelRelay"
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        logger.info(f"Certificate and private key generated: {cert_path}, {key_path}")
    except Exception as e:
        logger.error(f"Error executing openssl to generate certificate: {e}")
        raise e

async def handle_relay_client(reader, writer, padding_amount=0):
    peer = writer.get_extra_info('peername')
    logger.info(f"Incoming multiplexed secure session connection from local proxy client: {peer}")
    
    active_targets = {}  # stream_id -> target_writer
    try:
        # Step 1: Read the session handshake with padding
        handshake_bytes = await read_padded_data(reader)
        if not handshake_bytes or handshake_bytes != b"SESSION_INIT":
            logger.warning(f"Connection from {peer} dropped: session handshake was invalid or missing")
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass
            return
        
        logger.info(f"Session handshake successfully verified for {peer}. Generating SESSION_OK...")
        
        # Step 2: Send verification OK message back to proxy client with padding
        ok_msg = pad_data(b"SESSION_OK", padding_amount)
        writer.write(ok_msg)
        await writer.drain()
        logger.info(f"Session established. Switching to STMP multiplexing loop for {peer}")
        
        conn = STMPConnection(writer)

        async def target_handler(stream_id, host, port):
            try:
                logger.info(f"Session [{peer}]: stream {stream_id} connecting egress to {host}:{port}")
                t_reader, t_writer = await asyncio.open_connection(host, port)
                active_targets[stream_id] = t_writer
                await conn.write_frame(stream_id, CMD_CONNECT_OK)
                logger.info(f"Session [{peer}]: stream {stream_id} egress established to {host}:{port}")
                
                async def pipe_target_to_proxy():
                    try:
                        while True:
                            data = await t_reader.read(16384)
                            if not data:
                                break
                            await conn.write_frame(stream_id, CMD_DATA, data)
                    except Exception:
                        pass
                    finally:
                        await conn.write_frame(stream_id, CMD_CLOSE)
                        active_targets.pop(stream_id, None)
                        try:
                            t_writer.close()
                            await t_writer.wait_closed()
                        except Exception:
                            pass
                        logger.info(f"Session [{peer}]: stream {stream_id} closed target forwarding")

                asyncio.create_task(pipe_target_to_proxy())
            except Exception as ex:
                logger.error(f"Session [{peer}]: stream {stream_id} egress connection to {host}:{port} failed: {ex}")
                await conn.write_frame(stream_id, CMD_CONNECT_FAIL, str(ex).encode('utf-8'))

        # Step 3: Read loop
        while True:
            frame = await read_stmp_frame(reader)
            if frame is None:
                logger.info(f"Multiplexed session closed or EOF from local proxy {peer}")
                break
            
            stream_id, cmd, payload = frame
            
            if cmd == CMD_CONNECT:
                try:
                    destination = payload.decode('utf-8', errors='ignore').strip()
                    if ':' in destination:
                        host, port_str = destination.rsplit(':', 1)
                        port = int(port_str)
                        asyncio.create_task(target_handler(stream_id, host, port))
                    else:
                        await conn.write_frame(stream_id, CMD_CONNECT_FAIL, b"Invalid host:port format")
                except Exception as e:
                    await conn.write_frame(stream_id, CMD_CONNECT_FAIL, str(e).encode('utf-8'))
                    
            elif cmd == CMD_DATA:
                t_writer = active_targets.get(stream_id)
                if t_writer:
                    try:
                        t_writer.write(payload)
                        await t_writer.drain()
                    except Exception:
                        active_targets.pop(stream_id, None)
                        try:
                            t_writer.close()
                        except Exception:
                            pass
                        await conn.write_frame(stream_id, CMD_CLOSE)
                        
            elif cmd == CMD_CLOSE:
                t_writer = active_targets.pop(stream_id, None)
                if t_writer:
                    logger.info(f"Session [{peer}]: closing stream {stream_id} as requested by client")
                    try:
                        t_writer.close()
                    except Exception:
                        pass
                        
            elif cmd == CMD_KEEPALIVE:
                # Ping back keepalive
                await conn.write_frame(stream_id, CMD_KEEPALIVE)
                
    except Exception as e:
        logger.error(f"Errors occurred in relay conduit for client {peer}: {e}")
    finally:
        logger.info(f"Terminating multiplexed relay sessions and connections for client {peer}")
        # Clean up all targets for this session
        for stream_id, t_writer in list(active_targets.items()):
            try:
                t_writer.close()
            except Exception:
                pass
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass

async def main_async():
    parser = argparse.ArgumentParser(description="Secure TCP Relay Server")
    parser.add_argument("--host", default="0.0.0.0", help="Relay server listen address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=9999, help="Relay server listen port (default: 9999)")
    parser.add_argument("--cert", default="cert.pem", help="TLS certificate path (default: cert.pem)")
    parser.add_argument("--key", default="key.pem", help="TLS private key path (default: key.pem)")
    parser.add_argument("--padding", type=int, default=64, help="Approximate handshake padding amount in bytes (default: 64)")
    parser.add_argument("--loglevel", default="INFO", help="Visible log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)")
    args = parser.parse_args()
    
    # Configure logger level dynamically
    numeric_level = getattr(logging, args.loglevel.upper(), None)
    if not isinstance(numeric_level, int):
        numeric_level = logging.INFO
    logging.getLogger().setLevel(numeric_level)
    logger.setLevel(numeric_level)
    
    # Check or auto-generate certificate paths
    if not os.path.exists(args.cert) or not os.path.exists(args.key):
        try:
            generate_self_signed_cert(args.cert, args.key)
        except Exception:
            logger.critical("Fatal: Certificate keypair could not be loaded or auto-constructed.")
            sys.exit(1)
            
    # Set up Python SSL Server Context
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    try:
        ssl_context.load_cert_chain(certfile=args.cert, keyfile=args.key)
    except Exception as e:
        logger.critical(f"Fatal errors occurred loading SSL certification keys: {e}")
        sys.exit(1)
    
    server = await asyncio.start_server(
        lambda r, w: handle_relay_client(r, w, args.padding), args.host, args.port, ssl=ssl_context
    )
    
    addr = server.sockets[0].getsockname()
    logger.info(f"Secure Relay server listening on TLS/TCP socket at {addr[0]}:{addr[1]}")
    logger.info("Awaiting incoming TLS requests from proxy client...")
    
    async with server:
        await server.serve_forever()

def main():
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        logger.info("Relay server process stopped by user.")
    except Exception as e:
        logger.critical(f"Relay server crashed with unhandled exception: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
