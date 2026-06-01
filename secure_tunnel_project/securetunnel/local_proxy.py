import asyncio
import ssl
import sys
import argparse
import logging

# Configure logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("securetunnel-local")

async def handle_proxy_client(reader, writer, relay_host, relay_port, insecure):
    peer = writer.get_extra_info('peername')
    logger.info(f"Local connection from client {peer}")
    
    relay_writer = None
    try:
        # Read the browser's HTTP proxy CONNECT or general GET request headers
        header_data = b""
        while True:
            line = await reader.readline()
            if not line:
                break
            header_data += line
            if line == b"\r\n" or line == b"\n":
                break
                
        if not header_data:
            logger.warning(f"No HTTP headers received from client {peer}")
            return
            
        lines = header_data.decode('utf-8', errors='ignore').split('\r\n')
        request_line = lines[0]
        parts = request_line.split()
        if len(parts) < 2:
            logger.error(f"Invalid request line received from client {peer}: {request_line}")
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            await writer.drain()
            return

        method, target = parts[0], parts[1]
        
        # Determine host and port
        if method == "CONNECT":
            # HTTP Proxy CONNECT method (used by modern browsers for HTTPS)
            if ":" in target:
                host, port_str = target.rsplit(':', 1)
                port = int(port_str)
            else:
                host = target
                port = 443
        else:
            # Direct HTTP requests
            host = None
            port = 80
            if target.startswith("http://") or target.startswith("https://"):
                url_parts = target.split("//", 1)[1].split("/", 1)[0]
                if ":" in url_parts:
                    host, port_str = url_parts.split(":", 1)
                    port = int(port_str)
                else:
                    host = url_parts
                    port = 80 if target.startswith("http://") else 443
            else:
                # Find Target Host inside visual HTTP Headers
                for line in lines:
                    if line.lower().startswith("host:"):
                        host_header = line.split(":", 1)[1].strip()
                        if ":" in host_header:
                            host, port_str = host_header.split(":", 1)
                            port = int(port_str)
                        else:
                            host = host_header
                            port = 80
                        break
            if not host:
                logger.error(f"Failed to extract host from HTTP request from {peer}: {request_line}")
                writer.write(b"HTTP/1.1 400 Bad Request (No Host header or target)\r\n\r\n")
                await writer.drain()
                return

        logger.info(f"Target connection requested: {method} {host}:{port}")

        # Connect to secure remote relay
        ssl_context = ssl.create_default_context()
        if insecure:
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

        try:
            logger.info(f"Connecting to secure remote relay at TLS {relay_host}:{relay_port}...")
            relay_reader, relay_writer = await asyncio.open_connection(
                relay_host, relay_port, ssl=ssl_context
            )
            logger.info(f"Connected to secure remote relay {relay_host}:{relay_port}")
        except Exception as e:
            logger.error(f"Connection to remote relay {relay_host}:{relay_port} failed: {e}")
            writer.write(b"HTTP/1.1 502 Bad Gateway (Failed to connect to relay)\r\n\r\n")
            await writer.drain()
            return
            
        # Send target destination handshake to remote relay: host:port\n
        logger.info(f"Sending handshake header indicating target destination '{host}:{port}' to relay")
        handshake_payload = f"{host}:{port}\n".encode('utf-8')
        relay_writer.write(handshake_payload)
        await relay_writer.drain()
        
        # Expect response from remote relay (e.g. OK\n or ERROR)
        relay_reply = await relay_reader.readline()
        if not relay_reply:
            logger.error("Relay aborted connection abruptly during routing handshake")
            writer.write(b"HTTP/1.1 502 Bad Gateway (Relay closed socket)\r\n\r\n")
            await writer.drain()
            return
            
        relay_reply_msg = relay_reply.decode('utf-8').strip()
        if relay_reply_msg != "OK":
            logger.error(f"Relay rejected forwarding to destination: '{relay_reply_msg}'")
            writer.write(f"HTTP/1.1 502 Bad Gateway ({relay_reply_msg})\r\n\r\n".encode('utf-8'))
            await writer.drain()
            return
            
        # Complete handshake back to browser client for CONNECT request,
        # Or forward raw headers directly into relay stream for normal HTTP GET/POST and other requests.
        if method == "CONNECT":
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            logger.info(f"Tunnelling channel established to '{host}:{port}' via secure relay")
        else:
            relay_writer.write(header_data)
            await relay_writer.drain()
            logger.info(f"Header redirected to secure relay for non-CONNECT method {method} to '{host}:{port}'")

        # Set up bidirectional forwarding conduit
        async def forward_stream(src_reader, dest_writer, direction_tag):
            try:
                while True:
                    data = await src_reader.read(16384)
                    if not data:
                        break
                    dest_writer.write(data)
                    await dest_writer.drain()
            except Exception as ex:
                logger.debug(f"Stream error in direction {direction_tag}: {ex}")
            finally:
                try:
                    dest_writer.close()
                    await dest_writer.wait_closed()
                except Exception:
                    pass

        await asyncio.gather(
            forward_stream(reader, relay_writer, "client -> relay"),
            forward_stream(relay_reader, writer, "relay -> client")
        )

    except Exception as e:
        logger.error(f"Error handling proxy conduit for client {peer}: {e}")
    finally:
        logger.info(f"Closing client connection from {peer}")
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
        if relay_writer:
            try:
                relay_writer.close()
                await relay_writer.wait_closed()
            except Exception:
                pass

async def main_async():
    parser = argparse.ArgumentParser(description="Secure TCP Local Proxy Client")
    parser.add_argument("--host", default="127.0.0.1", help="Local proxy listen host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8888, help="Local proxy listen port (default: 8888)")
    parser.add_argument("--relay-host", default="127.0.0.1", help="Remote secure TCP relay host (default: 127.0.0.1)")
    parser.add_argument("--relay-port", type=int, default=9999, help="Remote secure TCP relay port (default: 9999)")
    parser.add_argument("--insecure", action="store_true", default=False, help="Relax TLS chain and hostname verification (useful for self-signed development relays)")
    args = parser.parse_args()
    
    server = await asyncio.start_server(
        lambda r, w: handle_proxy_client(r, w, args.relay_host, args.relay_port, args.insecure),
        args.host,
        args.port
    )
    
    addr = server.sockets[0].getsockname()
    logger.info(f"HTTP Proxy local server listening on http://{addr[0]}:{addr[1]}")
    logger.info(f"Tunnelling secure connections via Relay TLS {args.relay_host}:{args.relay_port}")
    if args.insecure:
        logger.warning("Certificate validation bypassed on outbound connections (--insecure)")
        
    async with server:
        await server.serve_forever()

def main():
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        logger.info("Proxy process interrupted by user.")
    except Exception as e:
        logger.critical(f"Fatal error running proxy: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
