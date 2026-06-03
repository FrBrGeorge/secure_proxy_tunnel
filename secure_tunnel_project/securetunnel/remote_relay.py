import asyncio
import ssl
import sys
import os
import argparse
import subprocess
import logging

from securetunnel.common import pad_data, read_padded_data

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
    logger.info(f"Incoming secure connection from local proxy client: {peer}")
    target_writer = None
    try:
        # Step 1: Read the target handshake line with padding
        target_bytes = await read_padded_data(reader)
        if not target_bytes:
            logger.warning(f"Connection from {peer} dropped before destination handshake header received")
            return
        
        target_str = target_bytes.decode('utf-8', errors='ignore').strip()
        logger.info(f"Handshake target routing instruction received from {peer}: '{target_str}'")
        
        if ':' not in target_str:
            logger.error(f"Handshake target format violation from {peer}: '{target_str}'")
            error_msg = pad_data(b"ERROR: Invalid handshake target format", padding_amount)
            writer.write(error_msg)
            await writer.drain()
            return
        
        host, port_str = target_str.rsplit(':', 1)
        try:
            port = int(port_str)
        except ValueError:
            logger.error(f"Handshake port number parse error: '{port_str}'")
            error_msg = pad_data(b"ERROR: Invalid port number", padding_amount)
            writer.write(error_msg)
            await writer.drain()
            return
            
        # Step 2: Establish connection to requested destination
        logger.info(f"Attempting egress connection to raw destination '{host}:{port}'...")
        try:
            target_reader, target_writer = await asyncio.open_connection(host, port)
            logger.info(f"Egress target connection successfully established to '{host}:{port}'")
        except Exception as e:
            logger.error(f"Egress target connection to '{host}:{port}' failed: {e}")
            error_msg = pad_data(f"ERROR: Target Unreachable - {e}".encode('utf-8'), padding_amount)
            writer.write(error_msg)
            await writer.drain()
            return
            
        # Step 3: Send verification OK message back to proxy client with padding
        ok_msg = pad_data(b"OK", padding_amount)
        writer.write(ok_msg)
        await writer.drain()
        logger.info(f"Routing handshake successfully completed. Coupling pipe conduits for {peer} <-> {host}:{port}")
        
        # Step 4: Bidirectional data proxy piping
        async def forward_stream(src_reader, dest_writer, direction_tag):
            try:
                while True:
                    data = await src_reader.read(16384)
                    if not data:
                        break
                    dest_writer.write(data)
                    await dest_writer.drain()
            except Exception as ex:
                logger.debug(f"Piping conduit error on {direction_tag}: {ex}")
            finally:
                try:
                    dest_writer.close()
                    await dest_writer.wait_closed()
                except Exception:
                    pass

        await asyncio.gather(
            forward_stream(reader, target_writer, "relay client -> destination"),
            forward_stream(target_reader, writer, "destination -> relay client")
        )
        
    except Exception as e:
        logger.error(f"Errors occurred in relay conduit for client {peer}: {e}")
    finally:
        logger.info(f"Terminating relay conduits and connections for client {peer}")
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        if target_writer:
            try:
                target_writer.close()
                await target_writer.wait_closed()
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
