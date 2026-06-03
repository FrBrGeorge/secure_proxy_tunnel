package com.securetunnel.android

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random

// STMP Multiplexed Protocol Command Constants
const val CMD_CONNECT: Byte = 1
const val CMD_CONNECT_OK: Byte = 2
const val CMD_CONNECT_FAIL: Byte = 3
const val CMD_DATA: Byte = 4
const val CMD_CLOSE: Byte = 5
const val CMD_KEEPALIVE: Byte = 6

object TunnelProtocol {
    fun writePaddedData(output: OutputStream, data: ByteArray, paddingAmount: Int) {
        val dataLen = data.size
        val padLen = if (paddingAmount <= 8) {
            0
        } else {
            Random.nextInt(0, paddingAmount - 8 + 1)
        }
        
        val buffer = java.io.ByteArrayOutputStream()
        
        buffer.write((dataLen ushr 24) and 0xFF)
        buffer.write((dataLen ushr 16) and 0xFF)
        buffer.write((dataLen ushr 8) and 0xFF)
        buffer.write(dataLen and 0xFF)
        
        buffer.write(data)
        
        buffer.write((padLen ushr 24) and 0xFF)
        buffer.write((padLen ushr 16) and 0xFF)
        buffer.write((padLen ushr 8) and 0xFF)
        buffer.write(padLen and 0xFF)
        
        if (padLen > 0) {
            val padBytes = ByteArray(padLen)
            Random.nextBytes(padBytes)
            buffer.write(padBytes)
        }
        
        output.write(buffer.toByteArray())
        output.flush()
    }

    fun readPaddedData(input: InputStream): ByteArray {
        val lenBytes = readExactly(input, 4)
        val payloadLen = (((lenBytes[0].toInt() and 0xFF) shl 24) or
                          ((lenBytes[1].toInt() and 0xFF) shl 16) or
                          ((lenBytes[2].toInt() and 0xFF) shl 8) or
                          (lenBytes[3].toInt() and 0xFF))
                          
        val payload = if (payloadLen > 0) {
            readExactly(input, payloadLen)
        } else {
            ByteArray(0)
        }
        
        val padLenBytes = readExactly(input, 4)
        val padLen = (((padLenBytes[0].toInt() and 0xFF) shl 24) or
                      ((padLenBytes[1].toInt() and 0xFF) shl 16) or
                      ((padLenBytes[2].toInt() and 0xFF) shl 8) or
                      (padLenBytes[3].toInt() and 0xFF))
                      
        if (padLen > 0) {
            readExactly(input, padLen)
        }
        
        return payload
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
}

class LocalProxyService : Service() {

    companion object {
        private const val TAG = "LocalProxyService"
        const val ACTION_START = "com.securetunnel.android.START_PROXY"
        const val ACTION_STOP = "com.securetunnel.android.STOP_PROXY"
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + Job())
    private var serverSocket: ServerSocket? = null
    private var proxyJob: Job? = null
    private val relaySession = RelaySessionManager(this)

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
                // Initialize the single persistent relay session to handshake ahead of first request
                launch {
                    try {
                        relaySession.ensureSession(config)
                    } catch (e: Exception) {
                        Log.w(TAG, "Relay session setup delayed or failed (will retry on demand): ${e.message}")
                    }
                }

                // Listen on all interfaces so it receives connections from VPN interface (e.g. 10.8.0.2) as well as loopback (127.0.0.1)
                serverSocket = ServerSocket(config.localPort, 50, InetAddress.getByName("0.0.0.0"))
                Log.i(TAG, "Proxy server listening on all interfaces at port ${config.localPort}")

                while (isActive) {
                    val clientSocket = serverSocket?.accept() ?: break
                    try {
                        clientSocket.keepAlive = true
                        clientSocket.tcpNoDelay = true
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to configure TCP settings on client socket: ${e.message}")
                    }
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
                    handleSocks5Client(firstByte, clientSocket, clientInput, clientOutput, config)
                } else {
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
        val streamId = relaySession.registerStream()
        val streamContext = relaySession.getStream(streamId) ?: return@withContext

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
                clientOutput.write(byteArrayOf(0x05, 0x08, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
                clientOutput.flush()
                return@withContext
            }

            // Read Port: 2 bytes
            val portBytes = readExactly(clientInput, 2)
            val targetPort = ((portBytes[0].toInt() and 0xFF) shl 8) or (portBytes[1].toInt() and 0xFF)

            Log.i(TAG, "SOCKS5 routing target requested: $targetHost:$targetPort in multiplexed session")

            // Ensure we have an active relay session (this will connect or reuse)
            relaySession.ensureSession(config)

            // Request egress connection
            val requestPayload = "$targetHost:$targetPort".toByteArray(Charsets.UTF_8)
            relaySession.writeFrame(streamId, CMD_CONNECT, requestPayload)

            // Await connection success response
            val isConnected = withTimeoutOrNull(15000) {
                streamContext.connectResult.receive()
            } ?: false

            if (!isConnected) {
                Log.e(TAG, "Relay rejected handshake or failed to establish egress connection.")
                clientOutput.write(byteArrayOf(0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
                clientOutput.flush()
                return@withContext
            }

            // SOCKS5 reply success: SOCKS5 reply code 0x00, atyp=0x01, ip=0.0.0.0, port=0
            clientOutput.write(byteArrayOf(0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
            clientOutput.flush()
            Log.i(TAG, "SOCKS5 proxy tunnel fully established to '$targetHost:$targetPort'")

            // Coupled raw direct bidirectional forwarding
            val clientToRelayJob = launch {
                val buffer = ByteArray(16384)
                try {
                    while (isActive) {
                        val r = clientInput.read(buffer)
                        if (r == -1) break
                        if (r > 0) {
                            val chunk = buffer.copyOfRange(0, r)
                            relaySession.writeFrame(streamId, CMD_DATA, chunk)
                        }
                    }
                } catch (e: Exception) {
                    // ignore
                } finally {
                    relaySession.writeFrame(streamId, CMD_CLOSE, byteArrayOf())
                    relaySession.unregisterStream(streamId)
                }
            }

            val relayToClientJob = launch {
                try {
                    for (chunk in streamContext.incomingQueue) {
                        clientOutput.write(chunk)
                        clientOutput.flush()
                    }
                } catch (e: Exception) {
                    // ignore
                } finally {
                    try { clientSocket.close() } catch (e: Exception) {}
                }
            }

            joinAll(clientToRelayJob, relayToClientJob)

        } catch (e: Exception) {
            Log.e(TAG, "SOCKS5 client routing error: ${e.message}")
            relaySession.writeFrame(streamId, CMD_CLOSE, byteArrayOf())
            relaySession.unregisterStream(streamId)
            try {
                clientOutput.write(byteArrayOf(0x05, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
                clientOutput.flush()
            } catch (ex: Exception) {}
        }
    }

    private suspend fun handleHttpClient(
        firstByte: Byte,
        clientSocket: Socket,
        clientInput: InputStream,
        clientOutput: OutputStream,
        config: TunnelConfig
    ) = withContext(Dispatchers.IO) {
        val streamId = relaySession.registerStream()
        val streamContext = relaySession.getStream(streamId) ?: return@withContext

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

            Log.i(TAG, "HTTP proxy routing requested: $method $targetHost:$targetPort in multiplexed session")

            // Ensure session is connected
            relaySession.ensureSession(config)

            // Request egress connection
            val requestPayload = "$targetHost:$targetPort".toByteArray(Charsets.UTF_8)
            relaySession.writeFrame(streamId, CMD_CONNECT, requestPayload)

            // Await connection success response
            val isConnected = withTimeoutOrNull(15000) {
                streamContext.connectResult.receive()
            } ?: false

            if (!isConnected) {
                Log.e(TAG, "Relay rejected handshake or failed to establish egress connection.")
                clientOutput.write("HTTP/1.1 502 Bad Gateway\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                return@withContext
            }

            // Connection successfully established
            if (method.equals("CONNECT", ignoreCase = true)) {
                clientOutput.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
                Log.i(TAG, "HTTP CONNECT proxy tunnel fully established to '$targetHost:$targetPort'")
            } else {
                // Pass parsed headers first
                relaySession.writeFrame(streamId, CMD_DATA, headerBytes)
                Log.i(TAG, "HTTP GET/POST header payload forwarded directly over multiplexed session to '$targetHost:$targetPort'")
            }

            // Coupled raw direct bidirectional forwarding
            val clientToRelayJob = launch {
                val buffer = ByteArray(16384)
                try {
                    while (isActive) {
                        val r = clientInput.read(buffer)
                        if (r == -1) break
                        if (r > 0) {
                            val chunk = buffer.copyOfRange(0, r)
                            relaySession.writeFrame(streamId, CMD_DATA, chunk)
                        }
                    }
                } catch (e: Exception) {
                    // ignore
                } finally {
                    relaySession.writeFrame(streamId, CMD_CLOSE, byteArrayOf())
                    relaySession.unregisterStream(streamId)
                }
            }

            val relayToClientJob = launch {
                try {
                    for (chunk in streamContext.incomingQueue) {
                        clientOutput.write(chunk)
                        clientOutput.flush()
                    }
                } catch (e: Exception) {
                    // ignore
                } finally {
                    try { clientSocket.close() } catch (e: Exception) {}
                }
            }

            joinAll(clientToRelayJob, relayToClientJob)

        } catch (e: Exception) {
            Log.e(TAG, "HTTP Proxy routing error: ${e.message}")
            relaySession.writeFrame(streamId, CMD_CLOSE, byteArrayOf())
            relaySession.unregisterStream(streamId)
            try {
                clientOutput.write("HTTP/1.1 502 Bad Gateway\r\n\r\n".toByteArray(Charsets.UTF_8))
                clientOutput.flush()
            } catch (ex: Exception) {}
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

    suspend fun connectToRelay(config: TunnelConfig): Socket = withContext(Dispatchers.IO) {
        if (config.isInsecureByDefault) {
            val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            })
            val sslContext = SSLContext.getInstance("TLS")
            sslContext.init(null, trustAllCerts, SecureRandom())
            val socketFactory = sslContext.socketFactory
            val rawSocket = Socket().apply {
                keepAlive = true
                tcpNoDelay = true
            }
            VpnModeService.protectSocket(rawSocket)
            rawSocket.connect(java.net.InetSocketAddress(config.relayHost, config.relayPort), 10000)
            
            val sslSocket = socketFactory.createSocket(rawSocket, config.relayHost, config.relayPort, true) as SSLSocket
            sslSocket.keepAlive = true
            sslSocket.startHandshake()
            sslSocket
        } else {
            val rawSocket = Socket().apply {
                keepAlive = true
                tcpNoDelay = true
            }
            VpnModeService.protectSocket(rawSocket)
            rawSocket.connect(java.net.InetSocketAddress(config.relayHost, config.relayPort), 10000)
            val sslSocketFactory = javax.net.ssl.SSLSocketFactory.getDefault() as javax.net.ssl.SSLSocketFactory
            val sslSocket = sslSocketFactory.createSocket(rawSocket, config.relayHost, config.relayPort, true) as SSLSocket
            sslSocket.keepAlive = true
            sslSocket.startHandshake()
            sslSocket
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
        relaySession.cleanupSession()
    }

    override fun onDestroy() {
        super.onDestroy()
        shutdownProxy()
        serviceScope.cancel()
    }

    class StreamContext {
        val connectResult = Channel<Boolean>(1)
        val incomingQueue = Channel<ByteArray>(Channel.UNLIMITED)
    }

    class RelaySessionManager(private val service: LocalProxyService) {
        private var relaySocket: Socket? = null
        private var relayInput: InputStream? = null
        private var relayOutput: OutputStream? = null
        private val nextStreamId = AtomicInteger(1)
        private val activeStreams = ConcurrentHashMap<Int, StreamContext>()
        private var readerJob: Job? = null

        @Synchronized
        fun registerStream(): Int {
            val id = nextStreamId.getAndIncrement()
            activeStreams[id] = StreamContext()
            return id
        }

        fun getStream(streamId: Int): StreamContext? = activeStreams[streamId]

        fun unregisterStream(streamId: Int) {
            activeStreams.remove(streamId)
        }

        @Synchronized
        fun ensureSession(config: TunnelConfig) {
            if (relaySocket != null && relaySocket!!.isConnected && !relaySocket!!.isClosed) {
                return
            }
            
            cleanupSession()
            
            Log.i(TAG, "Establishing single persistent multiplexed session to remote relay at ${config.relayHost}:${config.relayPort}...")
            try {
                val socket = runBlocking { service.connectToRelay(config) }
                relaySocket = socket
                val input = socket.getInputStream()
                relayInput = input
                val output = socket.getOutputStream()
                relayOutput = output

                // Send SESSION_INIT handshake with padding
                val initBytes = "SESSION_INIT".toByteArray(Charsets.UTF_8)
                TunnelProtocol.writePaddedData(output, initBytes, config.paddingAmount)

                // Read SESSION_OK handshake response
                val responseBytes = TunnelProtocol.readPaddedData(input)
                val responseStr = String(responseBytes, Charsets.UTF_8).trim()
                if (responseStr != "SESSION_OK") {
                    throw Exception("Handshake assertion failed: expected SESSION_OK but received '$responseStr'")
                }

                Log.i(TAG, "Multiplexed session handshake complete! Session active.")

                readerJob = service.serviceScope.launch {
                    runReaderLoop(input)
                }

            } catch (e: Exception) {
                Log.e(TAG, "Failed to establish multiplexed session to relay: ${e.message}", e)
                cleanupSession()
                throw e
            }
        }

        private suspend fun runReaderLoop(input: InputStream) = withContext(Dispatchers.IO) {
            val headerBuffer = ByteArray(9)
            try {
                while (isActive) {
                    readExactlyTo(input, headerBuffer, 9)
                    
                    val streamId = (((headerBuffer[0].toInt() and 0xFF) shl 24) or
                                   ((headerBuffer[1].toInt() and 0xFF) shl 16) or
                                   ((headerBuffer[2].toInt() and 0xFF) shl 8) or
                                   (headerBuffer[3].toInt() and 0xFF))
                    val cmd = headerBuffer[4]
                    val payloadLen = (((headerBuffer[5].toInt() and 0xFF) shl 24) or
                                     ((headerBuffer[6].toInt() and 0xFF) shl 16) or
                                     ((headerBuffer[7].toInt() and 0xFF) shl 8) or
                                     (headerBuffer[8].toInt() and 0xFF))

                    val payload = if (payloadLen > 0) {
                        val p = ByteArray(payloadLen)
                        readExactlyTo(input, p, payloadLen)
                        p
                    } else {
                        ByteArray(0)
                    }

                    val stream = activeStreams[streamId]
                    if (stream != null) {
                        when (cmd) {
                            CMD_CONNECT_OK -> {
                                stream.connectResult.trySend(true)
                            }
                            CMD_CONNECT_FAIL -> {
                                stream.connectResult.trySend(false)
                            }
                            CMD_DATA -> {
                                stream.incomingQueue.trySend(payload)
                            }
                            CMD_CLOSE -> {
                                stream.connectResult.trySend(false)
                                stream.incomingQueue.close()
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.d(TAG, "Multiplexed relay reader loop ended: ${e.message}")
            } finally {
                cleanupSession()
            }
        }

        private fun readExactlyTo(input: InputStream, buffer: ByteArray, bytesCount: Int) {
            var readBytes = 0
            while (readBytes < bytesCount) {
                val r = input.read(buffer, readBytes, bytesCount - readBytes)
                if (r == -1) throw java.io.EOFException("Relay session connection closed unexpectedly")
                readBytes += r
            }
        }

        fun writeFrame(streamId: Int, cmd: Byte, payload: ByteArray) {
            val out = relayOutput ?: return
            try {
                synchronized(out) {
                    val payloadLen = payload.size
                    val header = ByteArray(9)
                    header[0] = ((streamId ushr 24) and 0xFF).toByte()
                    header[1] = ((streamId ushr 16) and 0xFF).toByte()
                    header[2] = ((streamId ushr 8) and 0xFF).toByte()
                    header[3] = (streamId and 0xFF).toByte()
                    header[4] = cmd
                    header[5] = ((payloadLen ushr 24) and 0xFF).toByte()
                    header[6] = ((payloadLen ushr 16) and 0xFF).toByte()
                    header[7] = ((payloadLen ushr 8) and 0xFF).toByte()
                    header[8] = (payloadLen and 0xFF).toByte()

                    out.write(header)
                    if (payloadLen > 0) {
                        out.write(payload)
                    }
                    out.flush()
                }
            } catch (e: Exception) {
                Log.d(TAG, "Error writing frame: ${e.message}")
                cleanupSession()
            }
        }

        @Synchronized
        fun cleanupSession() {
            try { relaySocket?.close() } catch (e: Exception) {}
            relaySocket = null
            relayInput = null
            relayOutput = null
            readerJob?.cancel()
            readerJob = null
            
            for (stream in activeStreams.values) {
                stream.connectResult.trySend(false)
                stream.incomingQueue.close()
            }
            activeStreams.clear()
        }
    }
}
