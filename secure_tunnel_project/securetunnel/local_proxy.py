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

async def forward_stream(src_reader, dest_writer, direction_tag):
    try:
        while True:
            data = await src_reader.read(16384)
            if not data:
                break
            dest_writer.write(data)
            await dest_writer.drain()
    except Exception as ex:
        logger.debug(f"Piping conduit exception ({direction_tag}): {ex}")
    finally:
        try:
            dest_writer.close()
            await dest_writer.wait_closed()
        except Exception:
            pass

async def handle_socks5(reader, writer, relay_host, relay_port, insecure):
    peer = writer.get_extra_info('peername')
    try:
        # Read the remaining auth methods count
        nmethods_bytes = await reader.readexactly(1)
        nmethods = nmethods_bytes[0]
        # Read the methods themselves
        _ = await reader.readexactly(nmethods)
        
        # Respond with selected auth method: No Authentication (0x00)
        writer.write(b"\x05\x00")
        await writer.drain()
        
        # Read request header: version (1B), command (1B), reserved (1B), address type (1B)
        req_header = await reader.readexactly(4)
        ver, cmd, rsv, atyp = req_header
        
        if ver != 5 or cmd != 1:
            logger.error(f"SOCKS5 command ({cmd}) or version ({ver}) unsupported from {peer}")
            writer.write(b"\x05\x07\x00\x01\x00\x00\x00\x00\x00\x00")  # Command not supported
            await writer.drain()
            return
            
        # Extract host address depending on address type (atyp)
        if atyp == 0x01:  # IPv4
            ip_bytes = await reader.readexactly(4)
            host = ".".join(str(b) for b in ip_bytes)
        elif atyp == 0x03:  # Domain name
            domain_len_bytes = await reader.readexactly(1)
            domain_len = domain_len_bytes[0]
            domain_bytes = await reader.readexactly(domain_len)
            host = domain_bytes.decode('utf-8', errors='ignore')
        elif atyp == 0x04:  # IPv6
            ipv6_bytes = await reader.readexactly(16)
            host = ":".join(f"{ipv6_bytes[i]:02x}{ipv6_bytes[i+1]:02x}" for i in range(0, 16, 2))
        else:
            logger.error(f"SOCKS5 address type (ATYP {atyp}) unsupported from {peer}")
            writer.write(b"\x05\x08\x00\x01\x00\x00\x00\x00\x00\x00")  # Address type not supported
            await writer.drain()
            return
            
        # Read port numbers (2 bytes, big-endian)
        port_bytes = await reader.readexactly(2)
        port = int.from_bytes(port_bytes, 'big')
        
        logger.info(f"SOCKS5 Routing requested to target '{host}:{port}' for client {peer}")
        
        # Connect to secure remote relay
        ssl_context = ssl.create_default_context()
        if insecure:
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
        try:
            logger.info(f"Connecting SOCKS5 pipeline to remote relay at {relay_host}:{relay_port}...")
            relay_reader, relay_writer = await asyncio.open_connection(
                relay_host, relay_port, ssl=ssl_context
            )
            logger.info(f"SOCKS5 conduit connected to secure remote relay {relay_host}:{relay_port}")
        except Exception as e:
            logger.error(f"SOCKS5 egress connection to relay failed: {e}")
            writer.write(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00")  # Connection refused / host unreachable
            await writer.drain()
            return
            
        # Forward destination handshake header to remote relay: host:port\n
        logger.info(f"Relaying target routing instruction: '{host}:{port}' to TLS relay server")
        handshake_payload = f"{host}:{port}\n".encode('utf-8')
        relay_writer.write(handshake_payload)
        await relay_writer.drain()
        
        # Await relay acknowledgment
        relay_reply = await relay_reader.readline()
        if not relay_reply:
            logger.error("Relay closed socket execution during SOCKS5 target negotiation")
            writer.write(b"\x05\x03\x00\x01\x00\x00\x00\x00\x00\x00")  # Network unreachable
            await writer.drain()
            return
            
        relay_reply_msg = relay_reply.decode('utf-8').strip()
        if relay_reply_msg != "OK":
            logger.error(f"Relay rejected target instruction: '{relay_reply_msg}'")
            writer.write(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00")  # Connection refused
            await writer.drain()
            return
            
        # Inform client of connection success: SOCKS5 reply code 0x00 (succeeded), atyp=0x01, ip=0.0.0.0, port=03
        writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
        await writer.drain()
        logger.info(f"SOCKS5 proxy tunnel fully interconnected to '{host}:{port}'")
        
        # Coupled forwarding
        await asyncio.gather(
            forward_stream(reader, relay_writer, "socks5 client -> relay"),
            forward_stream(relay_reader, writer, "relay -> socks5 client")
        )
    except Exception as e:
        logger.error(f"Exception encountered in handling SOCKS5 flow from {peer}: {e}")

async def handle_http(first_byte, reader, writer, relay_host, relay_port, insecure):
    peer = writer.get_extra_info('peername')
    relay_writer = None
    try:
        # Read the rest of browser/http request headers
        header_data = first_byte
        while True:
            line = await reader.readline()
            if not line:
                break
            header_data += line
            if line == b"\r\n" or line == b"\n":
                break
                
        if not header_data or header_data == first_byte:
            logger.warning(f"No valid HTTP headers received from client {peer}")
            return
            
        decoded = header_data.decode('utf-8', errors='ignore')
        lines = [line.rstrip('\r\n') for line in decoded.splitlines()]
        if not lines:
            logger.warning(f"Failed to parse lines from client {peer}")
            return
            
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
            if ":" in target:
                host, port_str = target.rsplit(':', 1)
                port = int(port_str)
            else:
                host = target
                port = 443
        else:
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

        logger.info(f"Target connection requested via HTTP Proxy flow: {method} {host}:{port}")

        # Connect to secure remote relay
        ssl_context = ssl.create_default_context()
        if insecure:
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

        try:
            logger.info(f"Connecting HTTP proxy pipeline to remote relay at {relay_host}:{relay_port}...")
            relay_reader, relay_writer = await asyncio.open_connection(
                relay_host, relay_port, ssl=ssl_context
            )
            logger.info(f"HTTP proxy pipeline connected to secure remote relay {relay_host}:{relay_port}")
        except Exception as e:
            logger.error(f"HTTP proxy egress connection to secure remote relay failed: {e}")
            writer.write(b"HTTP/1.1 502 Bad Gateway (Failed to connect to relay)\r\n\r\n")
            await writer.drain()
            return
            
        # Send target destination handshake to remote relay: host:port\n
        logger.info(f"Relaying target routing instruction: '{host}:{port}' to TLS relay server")
        handshake_payload = f"{host}:{port}\n".encode('utf-8')
        relay_writer.write(handshake_payload)
        await relay_writer.drain()
        
        # Expect response from remote relay (OK\n or ERROR)
        relay_reply = await relay_reader.readline()
        if not relay_reply:
            logger.error("Relay aborted connection abruptly during HTTP routing handshake")
            writer.write(b"HTTP/1.1 502 Bad Gateway (Relay closed socket)\r\n\r\n")
            await writer.drain()
            return
            
        relay_reply_msg = relay_reply.decode('utf-8').strip()
        if relay_reply_msg != "OK":
            logger.error(f"Relay rejected target instruction: '{relay_reply_msg}'")
            writer.write(f"HTTP/1.1 502 Bad Gateway ({relay_reply_msg})\r\n\r\n".encode('utf-8'))
            await writer.drain()
            return
            
        # Complete handshake back to client for CONNECT requests, or forward full payload
        if method == "CONNECT":
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            logger.info(f"HTTP CONNECT proxy tunnel fully established to '{host}:{port}'")
        else:
            relay_writer.write(header_data)
            await relay_writer.drain()
            logger.info(f"HTTP GET/POST header payload forwarded directly to secure relay to '{host}:{port}'")

        # Coupled forwarding
        await asyncio.gather(
            forward_stream(reader, relay_writer, "http client -> relay"),
            forward_stream(relay_reader, writer, "relay -> http client")
        )
    except Exception as e:
         logger.error(f"General exception encountered in handling HTTP proxy client: {e}")
    finally:
        if relay_writer:
            try:
                relay_writer.close()
                await relay_writer.wait_closed()
            except Exception:
                pass

async def handle_proxy_client(reader, writer, relay_host, relay_port, insecure):
    peer = writer.get_extra_info('peername')
    logger.info(f"Local connection from client {peer}")
    
    try:
        # Pre-read the first byte of incoming traffic to inspect request type/protocol
        try:
            first_byte = await reader.readexactly(1)
        except asyncio.IncompleteReadError:
            logger.warning(f"Connection from client {peer} closed before initial bytes received")
            return

        if first_byte == b'\x05':
            # This is standard SOCKS5
            await handle_socks5(reader, writer, relay_host, relay_port, insecure)
        else:
            # Fall back to standard HTTP Proxy CONNECT/GET behavior
            await handle_http(first_byte, reader, writer, relay_host, relay_port, insecure)
            
    except Exception as e:
        logger.error(f"Error occurred routing tunnel conduit for client {peer}: {e}")
    finally:
        logger.info(f"Closing client connection from {peer}")
        try:
            writer.close()
            await writer.wait_closed()
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
