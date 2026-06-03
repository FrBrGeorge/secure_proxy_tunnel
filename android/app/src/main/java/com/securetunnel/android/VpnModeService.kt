package com.securetunnel.android

import android.content.Intent
import android.net.ProxyInfo
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.Socket
import java.nio.ByteBuffer

class VpnModeService : VpnService() {

    companion object {
        private const val TAG = "VpnModeService"
        const val ACTION_START = "com.securetunnel.android.START"
        const val ACTION_STOP = "com.securetunnel.android.STOP"

        @Volatile
        private var activeInstance: VpnModeService? = null

        /**
         * Protects an outbound socket from being routed back into the VPN interface.
         * Crucial to prevent infinite loops when communicating with the remote secure relay.
         */
        fun protectSocket(socket: Socket): Boolean {
            val inst = activeInstance
            return if (inst != null) {
                val success = inst.protect(socket)
                Log.d(TAG, "Relay socket protection: $success")
                success
            } else {
                Log.d(TAG, "No active VPN instance to protect socket.")
                false
            }
        }
    }

    private var vpnInterface: ParcelFileDescriptor? = null
    private val serviceScope = CoroutineScope(Dispatchers.IO + Job())
    private var vpnJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        activeInstance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action == ACTION_START) {
            setupVpn()
        } else if (action == ACTION_STOP) {
            shutdownVpn()
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun setupVpn() {
        if (vpnJob != null) return
        Log.i(TAG, "Starting Secure Tunnel VPN Seamless Mode...")

        val config = TunnelConfig.load(this)

        // 1. First ensure the dual SOCKS5/HTTP local proxy listener is running
        val startProxyIntent = Intent(this, LocalProxyService::class.java).apply {
            action = LocalProxyService.ACTION_START
        }
        startService(startProxyIntent)

        try {
            // 2. Build the virtual network interface inside Android Sandbox
            val builder = Builder()
                .setSession("SecureTunnelVPN")
                .addAddress("10.8.0.2", 32) // Assign virtual inner IP
                .addRoute("0.0.0.0", 0)       // Intercept all outgoing IPv4 internet traffic
                .addRoute("::", 0)            // Intercept all outgoing IPv6 internet traffic
                .addDnsServer("8.8.8.8")       // Intercept DNS queries
                .addDnsServer("1.1.1.1")
                .setMtu(1500)

            // Exclude our own application from the VPN routing to prevent any potential routing loops or conflicts
            try {
                builder.addDisallowedApplication(packageName)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to exclude our package from VPN: ${e.message}")
            }

            // Configure Android native HTTP/SOCKS system-wide proxy mapping to our proxy daemon on the VPN interface IP
            val proxyInfo = ProxyInfo.buildDirectProxy("10.8.0.2", config.localPort)
            builder.setHttpProxy(proxyInfo)

            vpnInterface = builder.establish()
            Log.i(TAG, "Virtual TUN interface established successfully with direct Local Proxy redirection")

            vpnJob = serviceScope.launch {
                runVpnTunnelLoop()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fatal error launching VPN interface:", e)
            shutdownVpn()
        }
    }

    private suspend fun runVpnTunnelLoop() {
        val fd = vpnInterface?.fileDescriptor ?: return
        val input = FileInputStream(fd).channel
        val output = FileOutputStream(fd).channel

        val buffer = ByteBuffer.allocate(32768)

        Log.i(TAG, "Seamless VPN Tunnel reading thread launched. Intercepting packets...")

        // Simple loop to read and discard raw packets from TUN interface since Android's system networking stack
        // handles the actual TCP redirection internally through our configured httpProxy redirect automatically.
        try {
            while (vpnJob?.isActive == true) {
                buffer.clear()
                val readLength = input.read(buffer)
                if (readLength > 0) {
                    // Packet fully consumed
                    buffer.flip()
                    Log.v(TAG, "Consumed raw TUN IP packet of size $readLength bytes")
                } else if (readLength < 0) {
                    break
                }
                delay(10)
            }
        } catch (e: Exception) {
            Log.e(TAG, "VPN raw Tunnel reading thread encountered exception:", e)
        }
    }

    private fun shutdownVpn() {
        Log.i(TAG, "Disconnecting VPN Interface...")
        vpnJob?.cancel()
        vpnJob = null
        try {
            vpnInterface?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Error closing tunnel handle: ${e.message}")
        }
        vpnInterface = null

        // Stop the localhost HTTP/SOCKS proxy daemon
        val stopProxyIntent = Intent(this, LocalProxyService::class.java).apply {
            action = LocalProxyService.ACTION_STOP
        }
        startService(stopProxyIntent)
    }

    override fun onDestroy() {
        super.onDestroy()
        shutdownVpn()
        serviceScope.cancel()
        if (activeInstance == this) {
            activeInstance = null
        }
    }
}
