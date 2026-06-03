package com.securetunnel.android

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.*
import kotlin.coroutines.coroutineContext
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import java.security.SecureRandom
import java.security.cert.X509Certificate
import kotlin.random.Random

class LocalProxyService : Service() {

    companion object {
        private const val TAG = "LocalProxyService"
        const val ACTION_START = "com.securetunnel.android.START_PROXY"
        const val ACTION_STOP = "com.securetunnel.android.STOP_PROXY"
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + Job())
    private var serverSocket: ServerSocket? = null
    private var proxyJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_START) {
            setupProxy()
        } else if (action == ACTION_STOP) {
            shutdownProxy()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun setupProxy() {
        if (proxyJob != null) return
        Log.i(TAG, "Starting dual SOCKS5/HTTP Localhost Proxy Service...")
        
        val config = TunnelConfig.load(this)
        
        proxyJob = serviceScope.launch {
            try {
                // Bind strictly to localhost (127.0.0.1) to avoid exposing the proxy interface
                serverSocket = ServerSocket(config.localPort, 50, InetAddress.getByName("127.0.0.1"))
                Log.i(TAG, "Localhost proxy server listening on 127.0.0.1:${config.localPort}")

                while (isActive) {
                    val clientSocket = serverSocket?.accept() ?: break
                    launch {
                        handleClientConnection(clientSocket, config)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server socket error or proxy shutdown: ${e.message}")
            }
        }
    }

    private suspend fun handleClientConnection(clientSocket: Socket, config: TunnelConfig) {
        withContext(Dispatchers.IO) {
            var relaySocket: Socket? = null
            try {
                val clientInput = clientSocket.getInputStream()
                val clientOutput = clientSocket.getOutputStream()

                // Read first byte to determine protocol (SOCKS5 vs HTTP)
                val firstByteInt = clientInput.read()
                if (firstByteInt == -1) {
                    Log.d(TAG, "Client closed connection immediately.")
                    return@withContext
                }
                val firstByte = firstByteInt.toByte()

                if (firstByte == 0x05.toByte()) {
                    // Standard SOCKS5 protocol flow
                    handleSocks5Client(firstByte, clientSocket, clientInput, clientOutput, config)
                } else {
                    // Fall back to standard HTTP / HTTP CONNECT Proxy flow
                    handleHttpClient(firstByte, clientSocket, clientInput, clientOutput, config)
                }

            } catch (e: Exception) {
                Log.e(TAG, "Error routing tunnel client:", e)
            } finally {
                try { clientSocket.close() } catch (ex: Exception) {}
            }
        }
    }

    private suspend fun handleSocks5Client(
        firstByte: Byte,
        clientSocket: Socket,
        clientInput: InputStream,
        clientOutput: OutputStream,
        config: TunnelConfig
    ) = withContext(Dispatchers.IO) {
        var relaySocket: Socket? = null
        try {
            // SOCKS5 Greeting: [nmethods (1B)][methods (nmethods bytes)]
            val nmethods = clientInput.read()
            if (nmethods == -1) return@withContext
            readExactly(clientInput, nmethods) // read and skip methods list

            // Respond with chosen auth method: No Authentication Required (0x05, 0x00)
            clientOutput.write(byteArrayOf(0x05, 0x00))
            clientOutput.flush()

            // Read SOCKS5 Request: [version(0x05)][cmd(1B)][reserved(0x00)][atyp(1B)]
            val reqHeader = readExactly(clientInput, 4)
            val ver = reqHeader[0].toInt() and 0xFF
            val cmd = reqHeader[1].toInt() and 0xFF
            val atyp = reqHeader[3].toInt() and 0xFF

            if (ver != 5 || cmd != 1) {
                Log.e(TAG, "Unsupported SOCKS5 option (ver: $ver, cmd: $cmd)")
                // Command not supported: [0x05][0x07][0x00][0x01][0x00..]
                clientOutput.write(byteArrayOf(0x05, 0x07, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
                clientOutput.flush()
                return@withContext
            }

            var targetHost = ""
            if (atyp == 0x01) { // IPv4 address: 4 bytes
                val ipBytes = readExactly(clientInput, 4)
                targetHost = "${ipBytes[0].toInt() and 0xFF}.${ipBytes[1].toInt() and 0xFF}.${ipBytes[2].toInt() and 0xFF}.${ipBytes[3].toInt() and 0xFF}"
            } else if (atyp == 0x03) { // Domain name: [len (1B)][domain (len bytes)]
                val domainLen = clientInput.read()
                if (domainLen == -1) return@withContext
                val domainBytes = readExactly(clientInput, domainLen)
                targetHost = String(domainBytes, Charsets.UTF_8)
            } else if (atyp == 0x04) { // IPv6 address: 16 bytes
                val ipBytes = readExactly(clientInput, 16)
                val hexParts = mutableListOf<String>()
                for (i in 0 until 16 step 2) {
                    val first = ipBytes[i].toInt() and 0xFF
                    val second = ipBytes[i + 1].toInt() and 0xFF
                    hexParts.add(String.format("%02x%02x", first, second))
                }
                targetHost = hexParts.joinToString(":")
            } else {
                Log.e(TAG, "Unsupported atyp type: $atyp")
                // Address type not supported
                clientOutput.write(byteArrayOf(0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
                clientOutput.flush()
                return@withContext
            }

            // Read Port: 2 bytes
            val portBytes = readExactly(clientInput, 2)
            val targetPort = ((portBytes[0].toInt() and 0xFF) shl 8) or (portBytes[1].toInt() and 0xFF)

            Log.i(TAG, "SOCKS5 routing target requested: $targetHost:$targetPort")

            // Connect to remote secure TLS/TCP relay
            val rSocket = try {
                connectToRelay(config)
            } catch (e: Exception) {
                Log.e(TAG, "SOCKS5 pipeline connection to remote relay failed: ${e.message}")
                clientOutput.write(byteArrayOf(0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)) // Connection refused
                clientOutput.flush()
                return@withContext
            }
            relaySocket = rSocket

            val relayInput = rSocket.getInputStream()
            val relayOutput = rSocket.getOutputStream()

            // Send target routing payload padded: "target_host:target_port"
            val handshakeBytes = "$targetHost:$targetPort".toByteArray(Charsets.UTF_8)
            TunnelProtocol.writePaddedData(relayOutput, handshakeBytes, config.paddingAmount)

            // Await verification OK message from relay
            val relayReplyBytes = TunnelProtocol.readPaddedData(relayInput)
            val relayReply = String(relayReplyBytes, Charsets.UTF_8).trim()

            if (relayReply != "OK") {
                Log.e(TAG, "Relay rejected handshake target instruction: '$relayReply'")
                clientOutput.write(byteArrayOf(0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)) // Connection refused
                clientOutput.flush()
                return@withContext
            }

            // SOCKS5 reply success: SOCKS5 reply code 0x00, atyp=0x01, ip=0.0.0.0, port=0
            clientOutput.write(byteArrayOf(0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
            clientOutput.flush()
            Log.i(TAG, "SOCKS5 proxy tunnel fully interconnected to '$targetHost:$targetPort'")

            // Coupled raw direct bidirectional forwarding
            val clientToRelayJob = launch { pipeRawStream(clientInput, relayOutput) }
            val relayToClientJob = launch { pipeRawStream(relayInput, clientOutput) }
            joinAll(clientToRelayJob, relayToClientJob)

        } catch (e: Exception) {
            Log.e(TAG, "SOCKS5 client routing error: ${e.message}")
        } finally {
            try { relaySocket?.close() } catch (ex: Exception) {}
        }
    }

    private suspend fun handleHttpClient(
        firstByte: Byte,
        clientSocket: Socket,
        clientInput: InputStream,
        clientOutput: OutputStream,
        config: TunnelConfig
    ) = withContext(Dispatchers.IO) {
        var relaySocket: Socket? = null
        try {
            // Read all lines of the HTTP headers
            val headerBytes = readHttpHeader(firstByte, clientInput)
            if (headerBytes.isEmpty()) return@withContext

            val decodedHeaders = String(headerBytes, Charsets.UTF_8)
            val lines = decodedHeaders.split(Regex("\\r?\\n")).map { it.trim() }.filter { it.isNotEmpty() }
            if (lines.isEmpty()) {
                clientOutput.write("HTTP/1.1 400 Bad Request\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                return@withContext
            }

            val requestLine = lines[0]
            val parts = requestLine.split(" ")
            if (parts.size < 2) {
                clientOutput.write("HTTP/1.1 400 Bad Request\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                return@withContext
            }

            val method = parts[0]
            val target = parts[1]

            var targetHost = ""
            var targetPort = 80

            if (method.equals("CONNECT", ignoreCase = true)) {
                if (target.contains(":")) {
                    val lastColon = target.lastIndexOf(':')
                    targetHost = target.substring(0, lastColon)
                    targetPort = target.substring(lastColon + 1).toIntOrNull() ?: 443
                } else {
                    targetHost = target
                    targetPort = 443
                }
            } else {
                if (target.startsWith("http://", ignoreCase = true) || target.startsWith("https://", ignoreCase = true)) {
                    val urlParts = target.substring(target.indexOf("//") + 2)
                    val hostPart = urlParts.split('/')[0]
                    if (hostPart.contains(":")) {
                        val lastColon = hostPart.lastIndexOf(':')
                        targetHost = hostPart.substring(0, lastColon)
                        targetPort = hostPart.substring(lastColon + 1).toIntOrNull() ?: if (target.startsWith("https://", ignoreCase = true)) 443 else 80
                    } else {
                        targetHost = hostPart
                        targetPort = if (target.startsWith("https://", ignoreCase = true)) 443 else 80
                    }
                } else {
                    // Try parsing from Host header
                    for (line in lines) {
                        if (line.startsWith("host:", ignoreCase = true)) {
                            val hostValue = line.substring(5).trim()
                            if (hostValue.contains(":")) {
                                val lastColon = hostValue.lastIndexOf(':')
                                targetHost = hostValue.substring(0, lastColon)
                                targetPort = hostValue.substring(lastColon + 1).toIntOrNull() ?: 80
                            } else {
                                targetHost = hostValue
                                targetPort = 80
                            }
                            break
                        }
                    }
                }
            }

            if (targetHost.isEmpty()) {
                Log.e(TAG, "Could not extract host from HTTP request: $requestLine")
                clientOutput.write("HTTP/1.1 400 Bad Request (No Host Header)\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                return@withContext
            }

            Log.i(TAG, "HTTP proxy routing requested: $method $targetHost:$targetPort")

            // Connect to remote secure TLS/TCP relay
            val rSocket = try {
                connectToRelay(config)
            } catch (e: Exception) {
                Log.e(TAG, "HTTP pipeline connection to remote relay failed: ${e.message}")
                clientOutput.write("HTTP/1.1 502 Bad Gateway\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                return@withContext
            }
            relaySocket = rSocket

            val relayInput = rSocket.getInputStream()
            val relayOutput = rSocket.getOutputStream()

            // Send target handshake details padded: "targetHost:targetPort"
            val handshakeBytes = "$targetHost:$targetPort".toByteArray(Charsets.UTF_8)
            TunnelProtocol.writePaddedData(relayOutput, handshakeBytes, config.paddingAmount)

            // Read target validation reply from remote relay
            val relayReplyBytes = TunnelProtocol.readPaddedData(relayInput)
            val relayReply = String(relayReplyBytes, Charsets.UTF_8).trim()

            if (relayReply != "OK") {
                Log.e(TAG, "Relay rejected target instruction: '$relayReply'")
                clientOutput.write("HTTP/1.1 502 Bad Gateway (${relayReply})\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                return@withContext
            }

            // Connection successfully established
            if (method.equals("CONNECT", ignoreCase = true)) {
                // Return proxy connection success code to browser/client
                clientOutput.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                Log.i(TAG, "HTTP CONNECT proxy tunnel fully established to '$targetHost:$targetPort'")
            } else {
                // For non-CONNECT requests (Ordinary GET/POST proxy), pass parsed headers first so raw endpoint handles it
                relayOutput.write(headerBytes)
                relayOutput.flush()
                Log.i(TAG, "HTTP GET/POST header payload forwarded directly to secure relay to '$targetHost:$targetPort'")
            }

            // Parallel direct raw stream forwarding loop
            val clientToRelayJob = launch { pipeRawStream(clientInput, relayOutput) }
            val relayToClientJob = launch { pipeRawStream(relayInput, clientOutput) }
            joinAll(clientToRelayJob, relayToClientJob)

        } catch (e: Exception) {
            Log.e(TAG, "HTTP Proxy routing error: ${e.message}")
        } finally {
            try { relaySocket?.close() } catch (ex: Exception) {}
        }
    }

    private suspend fun readHttpHeader(firstByte: Byte, input: InputStream): ByteArray = withContext(Dispatchers.IO) {
        val output = java.io.ByteArrayOutputStream()
        output.write(firstByte.toInt() and 0xFF)
        
        val lineBytes = java.io.ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1) break
            output.write(b)
            lineBytes.write(b)
            if (b == '\n'.code) {
                val lineStr = lineBytes.toByteArray().toString(Charsets.UTF_8).trim()
                if (lineStr.isEmpty()) {
                    break
                }
                lineBytes.reset()
            }
        }
        output.toByteArray()
    }

    private suspend fun connectToRelay(config: TunnelConfig): Socket = withContext(Dispatchers.IO) {
        if (config.isInsecureByDefault) {
            val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            })
            val sslContext = SSLContext.getInstance("TLS")
            sslContext.init(null, trustAllCerts, SecureRandom())
            val socketFactory = sslContext.socketFactory
            val rawSocket = Socket()
            VpnModeService.protectSocket(rawSocket)
            rawSocket.connect(java.net.InetSocketAddress(config.relayHost, config.relayPort), 10000)
            
            val sslSocket = socketFactory.createSocket(rawSocket, config.relayHost, config.relayPort, true) as SSLSocket
            sslSocket.startHandshake()
            sslSocket
        } else {
            val rawSocket = Socket()
            VpnModeService.protectSocket(rawSocket)
            rawSocket.connect(java.net.InetSocketAddress(config.relayHost, config.relayPort), 10000)
            val sslSocketFactory = javax.net.ssl.SSLSocketFactory.getDefault() as javax.net.ssl.SSLSocketFactory
            val sslSocket = sslSocketFactory.createSocket(rawSocket, config.relayHost, config.relayPort, true) as SSLSocket
            sslSocket.startHandshake()
            sslSocket
        }
    }

    private suspend fun pipeRawStream(input: InputStream, output: OutputStream) {
        val buffer = ByteArray(32768)
        try {
            while (coroutineContext.isActive) {
                val readBytes = input.read(buffer)
                if (readBytes == -1) break
                if (readBytes > 0) {
                    output.write(buffer, 0, readBytes)
                    output.flush()
                }
            }
        } catch (e: Exception) {
            // Stream closed or coroutine cancelled, safe to exit
        }
    }

    private fun readExactly(input: InputStream, numBytes: Int): ByteArray {
        val result = ByteArray(numBytes)
        var totalRead = 0
        while (totalRead < numBytes) {
            val r = input.read(result, totalRead, numBytes - totalRead)
            if (r == -1) throw java.io.EOFException("Unexpected end of file reading protocol stream")
            totalRead += r
        }
        return result
    }

    private fun shutdownProxy() {
        Log.i(TAG, "Stopping dual SOCKS5/HTTP localhost proxy listener...")
        proxyJob?.cancel()
        proxyJob = null
        try {
            serverSocket?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing server socket: ${e.message}")
        }
        serverSocket = null
    }

    override fun onDestroy() {
        super.onDestroy()
        shutdownProxy()
        serviceScope.cancel()
    }
}

object TunnelProtocol {
    private val secureRandom = SecureRandom()

    fun writePaddedData(output: OutputStream, data: ByteArray, paddingAmount: Int) {
        val msgLen = data.size
        val padLen = if (msgLen > 1024) {
            0
        } else if (paddingAmount > 0) {
            Random.nextInt(0, paddingAmount * 2 + 1)
        } else {
            0
        }

        val header = ByteArray(4)
        header[0] = ((msgLen ushr 8) and 0xFF).toByte()
        header[1] = (msgLen and 0xFF).toByte()
        header[2] = ((padLen ushr 8) and 0xFF).toByte()
        header[3] = (padLen and 0xFF).toByte()

        output.write(header)
        output.write(data)
        if (padLen > 0) {
            val padding = ByteArray(padLen)
            secureRandom.nextBytes(padding)
            output.write(padding)
        }
        output.flush()
    }

    fun readPaddedData(input: InputStream): ByteArray {
        val header = ByteArray(4)
        var readBytes = 0
        while (readBytes < 4) {
            val r = input.read(header, readBytes, 4 - readBytes)
            if (r == -1) return ByteArray(0)
            readBytes += r
        }

        val msgLen = ((header[0].toInt() and 0xFF) shl 8) or (header[1].toInt() and 0xFF)
        val padLen = ((header[2].toInt() and 0xFF) shl 8) or (header[3].toInt() and 0xFF)

        val totalLen = msgLen + padLen
        val payload = ByteArray(totalLen)
        var readPayloadBytes = 0
        while (readPayloadBytes < totalLen) {
            val r = input.read(payload, readPayloadBytes, totalLen - readPayloadBytes)
            if (r == -1) return ByteArray(0)
            readPayloadBytes += r
        }

        val result = ByteArray(msgLen)
        System.arraycopy(payload, 0, result, 0, msgLen)
        return result
    }
}
