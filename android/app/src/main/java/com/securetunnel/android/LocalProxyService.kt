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
        Log.i(TAG, "Starting Localhost HTTP Proxy Service...")
        
        val config = TunnelConfig.load(this)
        
        proxyJob = serviceScope.launch {
            try {
                // Bind strictly to localhost (127.0.0.1) to avoid exposing the proxy interface
                serverSocket = ServerSocket(config.localPort, 50, InetAddress.getByName("127.0.0.1"))
                Log.i(TAG, "Localhost HTTP Proxy listening on: http://127.0.0.1:${config.localPort}")

                while (isActive) {
                    val clientSocket = serverSocket?.accept() ?: break
                    launch {
                        handleClientConnection(clientSocket, config)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server socket error or proxy shutdown:", e)
            }
        }
    }

    private suspend fun handleClientConnection(clientSocket: Socket, config: TunnelConfig) {
        withContext(Dispatchers.IO) {
            var relaySocket: Socket? = null
            try {
                Log.d(TAG, "Incoming client request from localhost: ${clientSocket.port}")
                
                // Establish connection to Remote Relay
                if (config.isInsecureByDefault) {
                    // Create an SSL Context that bypasses trust manager verification (insecure mode = default)
                    val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
                        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
                        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
                    })
                    
                    val sslContext = SSLContext.getInstance("TLS")
                    sslContext.init(null, trustAllCerts, SecureRandom())
                    val socketFactory = sslContext.socketFactory
                    
                    // Create un-connected SSL socket then connect
                    val rawSocket = Socket()
                    rawSocket.connect(InetAddress.getByName(config.relayHost).let { java.net.InetSocketAddress(it, config.relayPort) }, 5000)
                    relaySocket = socketFactory.createSocket(rawSocket, config.relayHost, config.relayPort, true) as SSLSocket
                    (relaySocket as SSLSocket).startHandshake()
                    Log.d(TAG, "Insecure TLS handshake to relay succeeded.")
                } else {
                    // Strict verification
                    val rawSocket = Socket()
                    rawSocket.connect(java.net.InetSocketAddress(config.relayHost, config.relayPort), 5000)
                    val sslSocketFactory = javax.net.ssl.SSLSocketFactory.getDefault() as javax.net.ssl.SSLSocketFactory
                    relaySocket = sslSocketFactory.createSocket(rawSocket, config.relayHost, config.relayPort, true) as SSLSocket
                    (relaySocket as SSLSocket).startHandshake()
                    Log.d(TAG, "Strict TLS secure connection succeeded.")
                }

                val clientInput = clientSocket.getInputStream()
                val clientOutput = clientSocket.getOutputStream()
                val relayInput = relaySocket.getInputStream()
                val relayOutput = relaySocket.getOutputStream()

                // Bridge streams in parallel
                val jobToRelay = launch {
                    bridgeClientToRelay(clientInput, relayOutput, config)
                }
                val jobFromRelay = launch {
                    bridgeRelayToClient(relayInput, clientOutput)
                }

                joinAll(jobToRelay, jobFromRelay)

            } catch (e: Exception) {
                Log.e(TAG, "Error servicing client request:", e)
            } finally {
                try { clientSocket.close() } catch (ex: Exception) {}
                try { relaySocket?.close() } catch (ex: Exception) {}
            }
        }
    }

    private suspend fun bridgeClientToRelay(input: InputStream, output: OutputStream, config: TunnelConfig) {
        val buffer = ByteArray(16384)
        try {
            while (coroutineContext.isActive) {
                val readBytes = input.read(buffer)
                if (readBytes == -1) break
                if (readBytes > 0) {
                    // Protocol: 4 byte header [msg_len (2 bytes)][pad_len (2 bytes)]
                    // Followed by raw payload which is readBytes list
                    // If message is larger than 1024 bytes, pad_len is set to 0. Otherwise random padding up to 2 * amount
                    val isLarge = readBytes > 1024
                    val padLen = if (isLarge) 0 else (0..config.paddingAmount * 2).random()
                    
                    // Header packing
                    val header = ByteArray(4)
                    header[0] = ((readBytes shr 8) and 0xFF).toByte()
                    header[1] = (readBytes and 0xFF).toByte()
                    header[2] = ((padLen shr 8) and 0xFF).toByte()
                    header[3] = (padLen and 0xFF).toByte()

                    // Write header + original bytes
                    output.write(header)
                    output.write(buffer, 0, readBytes)

                    // Write randomized noise
                    if (padLen > 0) {
                        val noise = ByteArray(padLen)
                        SecureRandom().nextBytes(noise)
                        output.write(noise)
                    }
                    output.flush()
                }
            }
        } catch (e: Exception) {
            // Socket pipe closed
        }
    }

    private suspend fun bridgeRelayToClient(input: InputStream, output: OutputStream) {
        val buffer = ByteArray(16384)
        try {
            while (coroutineContext.isActive) {
                // Incoming stream from relay is unpadded plain data sent back to client
                val readBytes = input.read(buffer)
                if (readBytes == -1) break
                if (readBytes > 0) {
                    output.write(buffer, 0, readBytes)
                    output.flush()
                }
            }
        } catch (e: Exception) {
            // Socket pipe closed
        }
    }

    private fun shutdownProxy() {
        Log.i(TAG, "Stopping localhost HTTP proxy listener...")
        proxyJob?.cancel()
        proxyJob = null
        try {
            serverSocket?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing server socket:", e)
        }
        serverSocket = null
    }

    override fun onDestroy() {
        super.onDestroy()
        shutdownProxy()
        serviceScope.cancel()
    }
}
