import asyncio
import ssl
import socket
import unittest
import sys
import os

# Adjust path to import securetunnel modules if running directly
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from securetunnel.local_proxy import handle_proxy_client
from securetunnel.remote_relay import handle_relay_client, generate_self_signed_cert
from securetunnel.common import pad_data, read_padded_data

class TestTunnelInteraction(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cert_path = "test_cert.pem"
        self.key_path = "test_key.pem"
        
        # Ensure we have test TLS certificates
        if not os.path.exists(self.cert_path) or not os.path.exists(self.key_path):
            generate_self_signed_cert(self.cert_path, self.key_path)

        # Set up SSL Server Context for the Relay
        self.ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ssl_context.load_cert_chain(certfile=self.cert_path, keyfile=self.key_path)

        # 1. Start a simple HTTP/TCP Mock Echo Target Destination Server
        self.target_received_data = []
        async def handle_target_client(reader, writer):
            data = await reader.read(1024)
            self.target_received_data.append(data)
            # Mock simple HTTP response
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\n\r\nHello Target")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        self.target_server = await asyncio.start_server(handle_target_client, "127.0.0.1", 0)
        self.target_port = self.target_server.sockets[0].getsockname()[1]

        # 2. Start Secure TCP Remote Relay Server
        self.relay_server = await asyncio.start_server(
            handle_relay_client, "127.0.0.1", 0, ssl=self.ssl_context
        )
        self.relay_port = self.relay_server.sockets[0].getsockname()[1]

        # 3. Start Local HTTP Proxy Server.
        # It accepts HTTP connections and tunnels them to the secure TLS Relay
        async def run_local_proxy(reader, writer):
            await handle_proxy_client(
                reader, writer, "127.0.0.1", self.relay_port, insecure=True
            )

        self.proxy_server = await asyncio.start_server(run_local_proxy, "127.0.0.1", 0)
        self.proxy_port = self.proxy_server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.proxy_server.close()
        self.relay_server.close()
        self.target_server.close()
        await asyncio.gather(
            self.proxy_server.wait_closed(),
            self.relay_server.wait_closed(),
            self.target_server.wait_closed(),
            return_exceptions=True
        )
        
        # Cleanup temporary certificates
        for f in (self.cert_path, self.key_path):
            if os.path.exists(f):
                try:
                    os.unlink(f)
                except Exception:
                    pass

    async def test_http_proxy_get_transmission(self):
        """
        Verify that standard HTTP GET requests (non-CONNECT) bypass normal tunnel handshakes
        and forward raw HTTP headers appropriately into the secure tunnel.
        """
        # Connect to the local HTTP Proxy as a browser client would
        reader, writer = await asyncio.open_connection("127.0.0.1", self.proxy_port)

        # Send a standard HTTP proxy GET request indicating our destination server
        request = (
            f"GET http://127.0.0.1:{self.target_port}/test HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.target_port}\r\n"
            f"User-Agent: SecureTunnelTest\r\n"
            f"\r\n"
        )
        writer.write(request.encode('utf-8'))
        await writer.drain()

        # Read back response piped through the entire network chain
        response = await reader.read(4096)
        writer.close()
        await writer.wait_closed()

        self.assertIn(b"HTTP/1.1 200 OK", response)
        self.assertIn(b"Hello Target", response)
        self.assertTrue(len(self.target_received_data) > 0)
        self.assertIn(b"SecureTunnelTest", self.target_received_data[0])

    async def test_http_proxy_connect_tunneling(self):
        """
        Verify that HTTPS-style secure CONNECT tunneling method establishes an unencrypted
        handshake between browser and proxy first, then couples TLS streams successfully.
        """
        # Connect to the local HTTP Proxy
        reader, writer = await asyncio.open_connection("127.0.0.1", self.proxy_port)

        # Initiate CONNECT tunnel handshake
        connect_req = f"CONNECT 127.0.0.1:{self.target_port} HTTP/1.1\r\n\r\n"
        writer.write(connect_req.encode('utf-8'))
        await writer.drain()

        # Expect Tunnel confirmation ("200 Connection Established")
        headers = await reader.readline()
        self.assertIn(b"200 Connection Established", headers)

        # Clear remaining proxy handshake line delimiters (\r\n) before starting raw traffic
        await reader.readline()

        # Pipe raw segment bytes inside established encrypted conduit channel
        binary_payload = b"GET /secure-segment HTTP/1.1\r\nHost: mockhost\r\n\r\n"
        writer.write(binary_payload)
        await writer.drain()

        # Wait for downstream reply transmission
        response = await reader.read(4096)
        writer.close()
        await writer.wait_closed()

        self.assertIn(b"Hello Target", response)
        self.assertIn(b"mockhost", self.target_received_data[0])

    async def test_socks5_proxy_tunneling(self):
        """
        Verify SOCKS5 tunnel handshake and subsequent raw TCP data transfer:
        1. SOCKS5 Greeting: client sends self-announcement \x05\x01\x00 (version 5, 1 auth method: No Auth)
        2. SOCKS5 Server Response: server sends selected authentication method \x05\x00
        3. SOCKS5 Connection Request: client sends \x05\x01\x00\x01 + 4 bytes IPv4 + 2 bytes port (CONNECT)
        4. SOCKS5 Server Connection Response: server sends \x05\x00\x00\x01\x00\x00\x00\x00\x00\x00
        5. Verify that raw bytes forward cleanly to the target server.
        """
        reader, writer = await asyncio.open_connection("127.0.0.1", self.proxy_port)
        
        # 1. Greeting
        writer.write(b"\x05\x01\x00")
        await writer.drain()
        
        # 2. Server Response
        greet_resp = await reader.readexactly(2)
        self.assertEqual(greet_resp, b"\x05\x00")
        
        # 3. Connection Request (CONNECT IPv4 target_ip target_port)
        ip_parts = [int(p) for p in "127.0.0.1".split(".")]
        ip_bytes = bytes(ip_parts)
        port_bytes = self.target_port.to_bytes(2, "big")
        
        conn_req = b"\x05\x01\x00\x01" + ip_bytes + port_bytes
        writer.write(conn_req)
        await writer.drain()
        
        # 4. Server Connection Response
        conn_resp = await reader.readexactly(10)
        self.assertEqual(conn_resp[0], 5)   # SOCKS5 version
        self.assertEqual(conn_resp[1], 0)   # Reply code: success
        
        # 5. Send raw data over the decoupled SOCKS5 pipeline
        writer.write(b"GET /socks-test HTTP/1.1\r\nHost: socks-host\r\n\r\n")
        await writer.drain()
        
        # Read back response
        response = await reader.read(4096)
        writer.close()
        await writer.wait_closed()
        
        self.assertIn(b"HTTP/1.1 200 OK", response)
        self.assertIn(b"Hello Target", response)
        self.assertTrue(len(self.target_received_data) > 0)
        # Search for domain inside target received data records
        received_data_str = b"".join(self.target_received_data)
        self.assertIn(b"socks-host", received_data_str)


class TestPaddingUtility(unittest.TestCase):
    def test_padding_and_unpadding_behavior(self):
        """
        Verify that pad_data produces output that read_padded_data can reconstruct perfectly,
        testing with various padding amounts including 0.
        """
        async def verify_roundtrip(data: bytes, padding_amount: int):
            padded = pad_data(data, padding_amount)
            # The header is exactly 4 bytes (2 bytes msg_len + 2 bytes pad_len)
            self.assertTrue(len(padded) >= len(data) + 4)
            # Use an asyncio StreamReader mock to read it back
            reader = asyncio.StreamReader()
            reader.feed_data(padded)
            reader.feed_eof()
            unpadded = await read_padded_data(reader)
            self.assertEqual(data, unpadded)

        loop = asyncio.new_event_loop()
        try:
            for pad_amount in [0, 5, 20, 100]:
                loop.run_until_complete(verify_roundtrip(b"Hello world!", pad_amount))
                loop.run_until_complete(verify_roundtrip(b"", pad_amount))
                loop.run_until_complete(verify_roundtrip(os.urandom(1000), pad_amount))
        finally:
            loop.close()

    def test_no_padding_for_large_messages(self):
        """
        Verify that if length of the message is more than 1024 bytes, it needs no padding.
        The resulting length should be exactly len(data) + 4 (only the 4-byte header).
        """
        data = os.urandom(1025)
        padded = pad_data(data, padding_amount=100)
        # Header is 4 bytes + no padding = 1029 bytes exactly
        self.assertEqual(len(padded), len(data) + 4)
        # Verify the 2-bytes pad_len is 0
        pad_len = int.from_bytes(padded[2:4], 'big')
        self.assertEqual(pad_len, 0)

    def test_default_padding_is_64(self):
        """
        Verify that the default padding_amount is 64 when not specified.
        """
        data = b"Hello"
        padded = pad_data(data)
        # Max padding is randomized up to 2 * 64 = 128 bytes. Header is 4 bytes.
        # Max length should be 5 + 4 + 128 = 137 bytes.
        self.assertTrue(len(padded) <= len(data) + 4 + 128)


class TestTunnelInteractionWithPadding(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.cert_path = "test_cert_padded.pem"
        self.key_path = "test_key_padded.pem"
        self.padding_amount = 64
        
        # Ensure we have test TLS certificates
        if not os.path.exists(self.cert_path) or not os.path.exists(self.key_path):
            generate_self_signed_cert(self.cert_path, self.key_path)

        # Set up SSL Server Context for the Relay
        self.ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ssl_context.load_cert_chain(certfile=self.cert_path, keyfile=self.key_path)

        # 1. Start a simple HTTP/TCP Mock Echo Target Destination Server
        self.target_received_data = []
        async def handle_target_client(reader, writer):
            data = await reader.read(1024)
            self.target_received_data.append(data)
            # Mock simple HTTP response
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\n\r\nHello Target")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        self.target_server = await asyncio.start_server(handle_target_client, "127.0.0.1", 0)
        self.target_port = self.target_server.sockets[0].getsockname()[1]

        # 2. Start Secure TCP Remote Relay Server with padding
        async def run_relay(reader, writer):
            await handle_relay_client(reader, writer, self.padding_amount)

        self.relay_server = await asyncio.start_server(
            run_relay, "127.0.0.1", 0, ssl=self.ssl_context
        )
        self.relay_port = self.relay_server.sockets[0].getsockname()[1]

        # 3. Start Local HTTP Proxy Server with padding
        async def run_local_proxy(reader, writer):
            await handle_proxy_client(
                reader, writer, "127.0.0.1", self.relay_port, insecure=True, padding_amount=self.padding_amount
            )

        self.proxy_server = await asyncio.start_server(run_local_proxy, "127.0.0.1", 0)
        self.proxy_port = self.proxy_server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.proxy_server.close()
        self.relay_server.close()
        self.target_server.close()
        await asyncio.gather(
            self.proxy_server.wait_closed(),
            self.relay_server.wait_closed(),
            self.target_server.wait_closed(),
            return_exceptions=True
        )
        
        # Cleanup temporary certificates
        for f in (self.cert_path, self.key_path):
            if os.path.exists(f):
                try:
                    os.unlink(f)
                except Exception:
                    pass

    async def test_padded_http_proxy_get_transmission(self):
        """
        Verify that transmission works flawlessly with high-level randomized handshake padding.
        """
        reader, writer = await asyncio.open_connection("127.0.0.1", self.proxy_port)

        request = (
            f"GET http://127.0.0.1:{self.target_port}/test HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.target_port}\r\n"
            f"User-Agent: SecureTunnelTest\r\n"
            f"\r\n"
        )
        writer.write(request.encode('utf-8'))
        await writer.drain()

        response = await reader.read(4096)
        writer.close()
        await writer.wait_closed()

        self.assertIn(b"HTTP/1.1 200 OK", response)
        self.assertIn(b"Hello Target", response)
        self.assertTrue(len(self.target_received_data) > 0)


if __name__ == "__main__":
    unittest.main()
