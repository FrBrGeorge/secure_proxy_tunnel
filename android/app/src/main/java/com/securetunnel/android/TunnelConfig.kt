package com.securetunnel.android

import android.content.Context
import android.content.SharedPreferences

data class TunnelConfig(
    var relayHost: String = "10.0.2.2", // Standard Android emulator host mapping to host machine localhost
    var relayPort: Int = 19099,
    var localPort: Int = 19088,
    var paddingAmount: Int = 64, // Default changed to 64 bytes as requested
    var isInsecureByDefault: Boolean = true // Insecure mode default is true as requested
) {
    companion object {
        private const val PREFS_NAME = "secure_tunnel_prefs"
        private const val KEY_RELAY_HOST = "relay_host"
        private const val KEY_RELAY_PORT = "relay_port"
        private const val KEY_LOCAL_PORT = "local_port"
        private const val KEY_PADDING_AMOUNT = "padding_amount"
        private const val KEY_INSECURE_MODE = "insecure_mode"

        fun load(context: Context): TunnelConfig {
            val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            return TunnelConfig(
                relayHost = prefs.getString(KEY_RELAY_HOST, "10.0.2.2") ?: "10.0.2.2",
                relayPort = prefs.getInt(KEY_RELAY_PORT, 19099),
                localPort = prefs.getInt(KEY_LOCAL_PORT, 19088),
                paddingAmount = prefs.getInt(KEY_PADDING_AMOUNT, 64),
                isInsecureByDefault = prefs.getBoolean(KEY_INSECURE_MODE, true) // True by default
            )
        }
    }

    fun save(context: Context) {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().apply {
            putString(KEY_RELAY_HOST, relayHost)
            putInt(KEY_RELAY_PORT, relayPort)
            putInt(KEY_LOCAL_PORT, localPort)
            putInt(KEY_PADDING_AMOUNT, paddingAmount)
            putBoolean(KEY_INSECURE_MODE, isInsecureByDefault)
            apply()
        }
    }
}
