# SecureTunnel

`securetunnel` is a lightweight, zero-dependency, and highly efficient secure TCP proxy tunnel and relay system written in Python using native `asyncio`.

It provides two distinct entry points:
1. **Local Proxy Server (`securetunnel-local`)**: Accepts standard HTTP and HTTPS connections on `localhost` (without authentication or security controls) and pipes the traffic securely via dynamic TLS to the remote relay.
2. **Remote Relay (`securetunnel-relay`)**: Receives the secure TLS TCP connections, parses target routing headers, spawns egress sockets to the target web servers, and couples client data bidirectionally.

This implementation is compatible with all modern browsers (Chrome, Firefox, Safari) and operates out-of-the-box using the standard HTTPS Connect protocol.

---

## 🏗️ Architecture

```
[Browser / curl]
      │
      │ (Unencrypted HTTP CONNECT or GET)
      ▼
[local_proxy]  (securetunnel-local on localhost:8888)
      │
      │ (Secure TLS Connection over TCP)
      ▼
[remote_relay] (securetunnel-relay on 0.0.0.0:9999)
      │
      │ (Egress TCP Connection)
      ▼
[Target Web Host] (e.g. google.com:443)
```

---

## 🛠️ Installation

Change to the package directory and install the package using `pip` / `setuptools`:

```bash
# Local editable install (perfect for development)
pip install -e .

# Or standard install
pip install .
```

---

## 🚀 Running the Services

### 1. Start the Remote Relay
The remote relay starts a TLS server. If certificates (`cert.pem` and `key.pem`) do not exist, it will automatically attempt to generate a secure self-signed pair using `openssl`:

```bash
# Start relay server listening on port 9999
securetunnel-relay --host 0.0.0.0 --port 9999
```

**Parameters:**
* `--host`: Interface address to bind to (default: `0.0.0.0`).
* `--port`: Port to listen on (default: `9999`).
* `--cert`: Custom path to a PEM-formatted certificate file (default: `cert.pem`).
* `--key`: Custom path to a PEM-formatted private key file (default: `key.pem`).
* `--padding`: Approximate handshake randomized padding amount in bytes (default: `64`).

---

### 2. Start the Local Proxy Client
Launch the HTTP Proxy local handler. Be sure to configure the remote relay's connection address correctly:

```bash
# Start local proxy on port 8888, forwarding to relay on 9999
# `--insecure` ignores certificate warnings since we are using self-signed certs
securetunnel-local --host 127.0.0.1 --port 8888 --relay-host 127.0.0.1 --relay-port 9999 --insecure
```

**Parameters:**
* `--host`: Local bind address (default: `127.0.0.1`).
* `--port`: Local HTTP proxy port (default: `8888`).
* `--relay-host`: Destination host of the secure remote relay (default: `127.0.0.1`).
* `--relay-port`: Destination port of the secure remote relay (default: `9999`).
* `--insecure`: Disable verification of TLS certificate chain (required for auto-generated self-signed certificates).
* `--padding`: Approximate handshake randomized padding amount in bytes (default: `64`).

---

## 🏎️ Testing & Browser Configuration

### Core Verification using `curl`
To route calls through the tunnel via curl:

```bash
curl -v -x http://127.0.0.1:8888 https://httpbin.org/get
```

### Browser Configuration
You can configure any modern web browser to utilize the tunnel:

1. Locate your OS or Browser Proxy configuration parameters.
2. Select **HTTP Proxy** / **Secure Proxy**.
3. Point host to `127.0.0.1` and port to `8888`.
4. Apply configurations. All web requests will proceed securely via the TLS relay.

---

## 🔒 Handshake Padding Protocol (v0.0.4)

To defeat traffic analysis attacks, the initial handshake messages are encapsulated inside a custom padded stream:

### Header Structure
All handshakes use a compact **4-byte header**:
| Offset | Width (Bytes) | Field Name | Description |
|---|---|---|---|
| `0` | `2` | `msg_len` | 16-bit Big-Endian integer determining the actual payload size. |
| `2` | `2` | `pad_len` | 16-bit Big-Endian integer determining the randomized padding size. |

Followed directly by `msg_len` bytes of data and `pad_len` bytes of random noise padding.

### Optimized Rules
- **Automatic High-Overhead Skip**: If the handshake payload is larger than `1024` bytes, no padding is added (`pad_len = 0`) to avoid unnecessary CPU/bandwidth overhead.
- **Default Padding**: The default padding budget is `64` bytes (with real padding randomized between `0` and `2 * budget`).

