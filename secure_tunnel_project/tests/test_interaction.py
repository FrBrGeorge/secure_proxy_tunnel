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

if __name__ == "__main__":
    unittest.main()
