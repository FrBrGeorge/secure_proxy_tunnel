package com.securetunnel.android

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import java.io.File

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val VPN_PREPARE_REQUEST_CODE = 1002
    }

    private lateinit var etRelayHost: EditText
    private lateinit var etRelayPort: EditText
    private lateinit var etLocalPort: EditText
    private lateinit var etPaddingAmount: EditText
    private lateinit var cbInsecureMode: CheckBox
    
    private lateinit var rgModeSelection: RadioGroup
    private lateinit var rbVpnMode: RadioButton
    private lateinit var rbLocalProxyMode: RadioButton
    
    private lateinit var btnSaveConfig: Button
    private lateinit var btnToggleService: Button
    private lateinit var btnHelp: Button
    
    private lateinit var tvStatusText: TextView

    private var isTunnelActive = false
    private lateinit var activeConfig: TunnelConfig

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Assemble clean layout programmatically to eliminate XML view binding overhead
        val rootLayout = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(android.graphics.Color.parseColor("#F8FAFC")) // slate-50
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        // Title Header
        val brandHeader = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, 36)
        }
        val appTitle = TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 24f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#0F172A")) // slate-900
        }
        val appSubtitle = TextView(this).apply {
            text = "Lightweight Secure SSL/TLS Tunnel Client • v0.0.3"
            textSize = 12f
            setTextColor(android.graphics.Color.parseColor("#64748B")) // slate-500
        }
        brandHeader.addView(appTitle)
        brandHeader.addView(appSubtitle)
        container.addView(brandHeader)

        // Configuration Form Group Title
        val configTitle = TextView(this).apply {
            text = "CLIENT OPTIONS"
            textSize = 11f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#475569")) // slate-600
            letterSpacing = 0.15f
            setPadding(0, 0, 0, 16)
        }
        container.addView(configTitle)

        // Relay Host Field
        val lblHost = createLabel(getString(R.string.label_relay_host))
        etRelayHost = createInputField("10.0.2.2")
        container.addView(lblHost)
        container.addView(etRelayHost)

        // Relay Port Field
        val lblRelayPort = createLabel(getString(R.string.label_relay_port))
        etRelayPort = createInputField("19099")
        container.addView(lblRelayPort)
        container.addView(etRelayPort)

        // Local Proxy Port Field
        val lblLocalPort = createLabel(getString(R.string.label_local_port))
        etLocalPort = createInputField("19088")
        container.addView(lblLocalPort)
        container.addView(etLocalPort)

        // Padding Amount Field
        val lblPadding = createLabel(getString(R.string.label_padding_amount))
        etPaddingAmount = createInputField("64") // default 64
        container.addView(lblPadding)
        container.addView(etPaddingAmount)

        // Insecure check (Default is default ticked/true)
        cbInsecureMode = CheckBox(this).apply {
            text = getString(R.string.label_insecure_mode)
            setTextColor(android.graphics.Color.parseColor("#334155")) // slate-700
            textSize = 13f
            isChecked = true // Insecure mode default is true as requested
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 36
            }
            layoutParams = params
        }
        container.addView(cbInsecureMode)

        // Operation Mode Picker Group
        val modeGroupTitle = TextView(this).apply {
            text = "TUNNEL ROUTING MODE"
            textSize = 11f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#475569"))
            letterSpacing = 0.15f
            setPadding(0, 0, 0, 12)
        }
        container.addView(modeGroupTitle)

        rgModeSelection = RadioGroup(this).apply {
            orientation = RadioGroup.HORIZONTAL
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 48
            }
            layoutParams = params
        }
        
        rbVpnMode = RadioButton(this).apply {
            text = "VPN API (Seamless)"
            id = android.view.View.generateViewId()
        }
        rbLocalProxyMode = RadioButton(this).apply {
            text = "Localhost HTTP Proxy"
            id = android.view.View.generateViewId()
            isChecked = true // Starting with localhost proxy
        }
        rgModeSelection.addView(rbLocalProxyMode)
        rgModeSelection.addView(rbVpnMode)
        container.addView(rgModeSelection)

        // Control Actions Layout (Buttons)
        btnSaveConfig = Button(this).apply {
            text = getString(R.string.label_save_settings)
            setBackgroundColor(android.graphics.Color.parseColor("#475569")) // slate
            setTextColor(android.graphics.Color.WHITE)
            setPadding(0, 24, 0, 24)
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 16
            }
            layoutParams = params
        }
        container.addView(btnSaveConfig)

        btnToggleService = Button(this).apply {
            text = getString(R.string.button_start)
            setBackgroundColor(android.graphics.Color.parseColor("#0F172A")) // deep dark slate
            setTextColor(android.graphics.Color.WHITE)
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 32, 0, 32)
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 16
            }
            layoutParams = params
        }
        container.addView(btnToggleService)

        btnHelp = Button(this).apply {
            text = "Read Secure Tunnel Help"
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setTextColor(android.graphics.Color.parseColor("#1E293B"))
            setTypeface(null, android.graphics.Typeface.ITALIC)
            setOnClickListener {
                startActivity(Intent(this@MainActivity, HelpActivity::class.java))
            }
        }
        container.addView(btnHelp)

        // Visual Tunnel Connection Status Badge
        tvStatusText = TextView(this).apply {
            text = getString(R.string.status_stopped)
            textSize = 14f
            setTextColor(android.graphics.Color.parseColor("#EF4444")) // red-500
            setTypeface(null, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, 36, 0, 0)
        }
        container.addView(tvStatusText)

        rootLayout.addView(container)
        setContentView(rootLayout)

        // Load configs and pop views
        loadConfigAndPopulate()

        // Bind Save Action
        btnSaveConfig.setOnClickListener {
            saveConfigFromViews()
            Toast.makeText(this, "Settings written successfully!", Toast.LENGTH_SHORT).show()
        }

        // Bind Power Toggle Action
        btnToggleService.setOnClickListener {
            toggleSecureTunnel()
        }
    }

    private fun createLabel(textVal: String): TextView {
        return TextView(this).apply {
            text = textVal
            textSize = 11f
            setTextColor(android.graphics.Color.parseColor("#64748B"))
            setPadding(0, 12, 0, 8)
        }
    }

    private fun createInputField(defaultText: String): EditText {
        return EditText(this).apply {
            setText(defaultText)
            textSize = 14f
            setTextColor(android.graphics.Color.parseColor("#1E293B"))
            setBackgroundColor(android.graphics.Color.parseColor("#E2E8F0"))
            setPadding(24, 24, 24, 24)
            val params = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 16
            }
            layoutParams = params
        }
    }

    private fun loadConfigAndPopulate() {
        activeConfig = TunnelConfig.load(this)
        etRelayHost.setText(activeConfig.relayHost)
        etRelayPort.setText(activeConfig.relayPort.toString())
        etLocalPort.setText(activeConfig.localPort.toString())
        etPaddingAmount.setText(activeConfig.paddingAmount.toString())
        cbInsecureMode.isChecked = activeConfig.isInsecureByDefault
    }

    private fun saveConfigFromViews() {
        activeConfig.relayHost = etRelayHost.text.toString().trim()
        activeConfig.relayPort = etRelayPort.text.toString().toIntOrNull() ?: 19099
        activeConfig.localPort = etLocalPort.text.toString().toIntOrNull() ?: 19088
        activeConfig.paddingAmount = etPaddingAmount.text.toString().toIntOrNull() ?: 64
        activeConfig.isInsecureByDefault = cbInsecureMode.isChecked
        activeConfig.save(this)
    }

    private fun toggleSecureTunnel() {
        if (isTunnelActive) {
            // Stopping Services
            stopActiveServices()
            btnToggleService.text = getString(R.string.button_start)
            btnToggleService.setBackgroundColor(android.graphics.Color.parseColor("#0F172A"))
            tvStatusText.text = getString(R.string.status_stopped)
            tvStatusText.setTextColor(android.graphics.Color.parseColor("#EF4444"))
            isTunnelActive = false
            lockConfigFields(true)
        } else {
            // First save view preferences to guarantee configuration is applied
            saveConfigFromViews()
            
            // Starting client node
            if (rbVpnMode.isChecked) {
                // Check VPN privileges (Android system triggers confirmation dialog if not already authorized)
                val intent = VpnService.prepare(this)
                if (intent != null) {
                    startActivityForResult(intent, VPN_PREPARE_REQUEST_CODE)
                } else {
                    onActivityResult(VPN_PREPARE_REQUEST_CODE, Activity.RESULT_OK, null)
                }
            } else {
                // Start Direct Localhost HTTP TCP proxy
                val intent = Intent(this, LocalProxyService::class.java).apply {
                    action = LocalProxyService.ACTION_START
                }
                startService(intent)
                onTunnelConnected()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == VPN_PREPARE_REQUEST_CODE && resultCode == Activity.RESULT_OK) {
            val intent = Intent(this, VpnModeService::class.java).apply {
                action = VpnModeService.ACTION_START
            }
            startService(intent)
            onTunnelConnected()
        }
    }

    private fun onTunnelConnected() {
        btnToggleService.text = getString(R.string.button_stop)
        btnToggleService.setBackgroundColor(android.graphics.Color.parseColor("#10B981")) // green-500
        tvStatusText.text = getString(R.string.status_running) + " [Mode: " + (if (rbVpnMode.isChecked) "VPN Seamless" else "HTTP Localhost") + "]"
        tvStatusText.setTextColor(android.graphics.Color.parseColor("#10B981"))
        isTunnelActive = true
        lockConfigFields(false)
    }

    private fun stopActiveServices() {
        // Safe disconnection signals sent to both potential services
        val vpnIntent = Intent(this, VpnModeService::class.java).apply {
            action = VpnModeService.ACTION_STOP
        }
        startService(vpnIntent)

        val proxyIntent = Intent(this, LocalProxyService::class.java).apply {
            action = LocalProxyService.ACTION_STOP
        }
        startService(proxyIntent)
    }

    private fun lockConfigFields(enable: Boolean) {
        etRelayHost.isEnabled = enable
        etRelayPort.isEnabled = enable
        etLocalPort.isEnabled = enable
        etPaddingAmount.isEnabled = enable
        cbInsecureMode.isEnabled = enable
        rbVpnMode.isEnabled = enable
        rbLocalProxyMode.isEnabled = enable
    }

    override fun onDestroy() {
        super.onDestroy()
        // Stop background tunnels when activity teardown is initiated if desired or leave in foreground
    }
}
