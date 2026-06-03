import asyncio
import ssl
import sys
import argparse
import logging
import socket

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
logger = logging.getLogger("securetunnel-local")

def setup_socket_options(writer):
    try:
        sock = writer.get_extra_info('socket')
        if sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except Exception:
                pass
    except Exception:
        pass

class RelaySessionManager:
    def __init__(self, relay_host, relay_port, insecure, padding_amount):
        self.relay_host = relay_host
        self.relay_port = relay_port
        self.insecure = insecure
        self.padding_amount = padding_amount
        self.conn = None
        self.lock = asyncio.Lock()
        self.active_streams = {}  # stream_id -> {'queue': asyncio.Queue, 'connect_fut': asyncio.Future}
        self.next_stream_id = 1
        self.reader_task = None

    async def get_connection(self):
        async with self.lock:
            if self.conn is not None:
                return self.conn
            
            ssl_context = ssl.create_default_context()
            if self.insecure:
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
                
            try:
                logger.info(f"Establishing new multiplexed session to secure remote relay at {self.relay_host}:{self.relay_port}...")
                reader, writer = await asyncio.open_connection(
                    self.relay_host, self.relay_port, ssl=ssl_context
                )
                setup_socket_options(writer)
                
                # Perform session handshake with padding
                handshake_payload = b"SESSION_INIT"
                padded_payload = pad_data(handshake_payload, self.padding_amount)
                writer.write(padded_payload)
                await writer.drain()
                
                # Await relay acknowledgment with padding
                relay_reply = await read_padded_data(reader)
                if not relay_reply or relay_reply != b"SESSION_OK":
                    raise Exception("Handshake validation failed or session rejected by remote TLS relay")
                
                logger.info("Session with secure remote relay established successfully!")
                self.conn = STMPConnection(writer)
                
                # Spawn background reader loop
                self.reader_task = asyncio.create_task(self._reader_loop(reader))
                return self.conn
            except Exception as e:
                logger.error(f"Failed to connect to secure remote relay: {e}")
                self.conn = None
                raise e

    async def _reader_loop(self, reader):
        try:
            while True:
                frame = await read_stmp_frame(reader)
                if frame is None:
                    break
                
                stream_id, cmd, payload = frame
                stream = self.active_streams.get(stream_id)
                if not stream:
                    continue
                
                if cmd == CMD_CONNECT_OK:
                    fut = stream['connect_fut']
                    if not fut.done():
                        fut.set_result(True)
                elif cmd == CMD_CONNECT_FAIL:
                    fut = stream['connect_fut']
                    if not fut.done():
                        fut.set_result(False)
                elif cmd == CMD_DATA:
                    await stream['queue'].put((CMD_DATA, payload))
                elif cmd == CMD_CLOSE:
                    await stream['queue'].put((CMD_CLOSE, b""))
                    fut = stream['connect_fut']
                    if not fut.done():
                        fut.set_result(False)
        except Exception as e:
            logger.debug(f"Error in relay session reader loop: {e}")
        finally:
            logger.warning("Relay connection session died.")
            await self.reset_connection()

    async def reset_connection(self):
        async with self.lock:
            if self.conn:
                await self.conn.close()
                self.conn = None
            if self.reader_task:
                self.reader_task.cancel()
                self.reader_task = None
            
            # Fail all waiting streams and write close to queue
            for stream in list(self.active_streams.values()):
                fut = stream['connect_fut']
                if not fut.done():
                    fut.set_result(False)
                await stream['queue'].put((CMD_CLOSE, b""))
            self.active_streams.clear()

    async def create_stream(self, host, port):
        conn = await self.get_connection()
        
        async with self.lock:
            stream_id = self.next_stream_id
            self.next_stream_id += 1
            stream = {
                'queue': asyncio.Queue(),
                'connect_fut': asyncio.get_running_loop().create_future()
            }
            self.active_streams[stream_id] = stream
            
        logger.info(f"Requesting remote relay egress for streamID {stream_id} -> '{host}:{port}'")
        dest_payload = f"{host}:{port}".encode('utf-8')
        await conn.write_frame(stream_id, CMD_CONNECT, dest_payload)
        
        success = await stream['connect_fut']
        if success:
            return stream_id, stream['queue']
        else:
            async with self.lock:
                self.active_streams.pop(stream_id, None)
            raise Exception("Remote egress target connection failed")

    async def send_data(self, stream_id, data):
        if self.conn:
            await self.conn.write_frame(stream_id, CMD_DATA, data)

    async def close_stream(self, stream_id):
        async with self.lock:
            self.active_streams.pop(stream_id, None)
        if self.conn:
            await self.conn.write_frame(stream_id, CMD_CLOSE)

session_manager = None

async def handle_socks5(reader, writer, insecure, padding_amount=0):
    peer = writer.get_extra_info('peername')
    try:
        nmethods_bytes = await reader.readexactly(1)
        nmethods = nmethods_bytes[0]
        _ = await reader.readexactly(nmethods)
        
        writer.write(b"\x05\x00")
        await writer.drain()
        
        req_header = await reader.readexactly(4)
        ver, cmd, rsv, atyp = req_header
        
        if ver != 5 or cmd != 1:
            logger.error(f"SOCKS5 command ({cmd}) or version ({ver}) unsupported from {peer}")
            writer.write(b"\x05\x07\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()
            return
            
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
            writer.write(b"\x05\x08\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()
            return
            
        port_bytes = await reader.readexactly(2)
        port = int.from_bytes(port_bytes, 'big')
        
        logger.info(f"SOCKS5 Routing requested to target '{host}:{port}' for client {peer}")
        
        # Open multiplexed stream
        try:
            stream_id, queue = await session_manager.create_stream(host, port)
        except Exception as e:
            logger.error(f"SOCKS5 multiplexed stream registration failed: {e}")
            writer.write(b"\x05\x05\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()
            return
            
        # SOCKS5 reply success
        writer.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
        await writer.drain()
        logger.info(f"SOCKS5 proxy tunnel fully interconnected to '{host}:{port}'")
        
        async def client_to_relay():
            try:
                while True:
                    data = await reader.read(16384)
                    if not data:
                        break
                    await session_manager.send_data(stream_id, data)
            except Exception:
                pass
            finally:
                await session_manager.close_stream(stream_id)

        async def relay_to_client():
            try:
                while True:
                    cmd, data = await queue.get()
                    if cmd == CMD_CLOSE:
                        break
                    writer.write(data)
                    await writer.drain()
            except Exception:
                pass
            finally:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass

        # Coupled forwarding
        t1 = asyncio.create_task(client_to_relay())
        t2 = asyncio.create_task(relay_to_client())
        await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
        t1.cancel()
        t2.cancel()
    except Exception as e:
        logger.error(f"Exception encountered in handling SOCKS5 flow from {peer}: {e}")

async def handle_http(first_byte, reader, writer, insecure, padding_amount=0):
    peer = writer.get_extra_info('peername')
    try:
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

        # Open multiplexed stream
        try:
            stream_id, queue = await session_manager.create_stream(host, port)
        except Exception as e:
            logger.error(f"HTTP stream establishment failed: {e}")
            writer.write(b"HTTP/1.1 502 Bad Gateway (Failed to connect to relay)\r\n\r\n")
            await writer.drain()
            return
            
        if method == "CONNECT":
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            logger.info(f"HTTP CONNECT proxy tunnel fully established to '{host}:{port}'")
        else:
            await session_manager.send_data(stream_id, header_data)
            logger.info(f"HTTP GET/POST header payload forwarded directly to secure relay to '{host}:{port}'")

        async def client_to_relay():
            try:
                while True:
                    data = await reader.read(16384)
                    if not data:
                        break
                    await session_manager.send_data(stream_id, data)
            except Exception:
                pass
            finally:
                await session_manager.close_stream(stream_id)

        async def relay_to_client():
            try:
                while True:
                    cmd, data = await queue.get()
                    if cmd == CMD_CLOSE:
                        break
                    writer.write(data)
                    await writer.drain()
            except Exception:
                pass
            finally:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass

        # Coupled forwarding
        t1 = asyncio.create_task(client_to_relay())
        t2 = asyncio.create_task(relay_to_client())
        await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
        t1.cancel()
        t2.cancel()
    except Exception as e:
         logger.error(f"General exception encountered in handling HTTP proxy client: {e}")

async def handle_proxy_client(reader, writer, insecure, padding_amount=0):
    peer = writer.get_extra_info('peername')
    logger.info(f"Local connection from client {peer}")
    setup_socket_options(writer)
    
    try:
        try:
            first_byte = await reader.readexactly(1)
        except asyncio.IncompleteReadError:
            logger.warning(f"Connection from client {peer} closed before initial bytes received")
            return

        if first_byte == b'\x05':
            await handle_socks5(reader, writer, insecure, padding_amount)
        else:
            await handle_http(first_byte, reader, writer, insecure, padding_amount)
            
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
    parser.add_argument("--padding", type=int, default=64, help="Approximate handshake padding amount in bytes (default: 64)")
    parser.add_argument("--loglevel", default="INFO", help="Visible log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)")
    args = parser.parse_args()
    
    # Configure logger level dynamically
    numeric_level = getattr(logging, args.loglevel.upper(), None)
    if not isinstance(numeric_level, int):
        numeric_level = logging.INFO
    logging.getLogger().setLevel(numeric_level)
    logger.setLevel(numeric_level)
    
    global session_manager
    session_manager = RelaySessionManager(
        args.relay_host, args.relay_port, args.insecure, args.padding
    )
    
    try:
        await session_manager.get_connection()
    except Exception as e:
        logger.warning(f"Could not establish initial session with relay (will retry on demand): {e}")
        
    server = await asyncio.start_server(
        lambda r, w: handle_proxy_client(r, w, args.insecure, args.padding),
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
