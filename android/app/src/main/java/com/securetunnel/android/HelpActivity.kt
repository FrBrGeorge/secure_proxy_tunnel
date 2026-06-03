package com.securetunnel.android

import android.os.Bundle
import android.text.Html
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class HelpActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Simple elegant dialog layout created programmatically
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(36, 36, 36, 36)
            setBackgroundColor(android.graphics.Color.WHITE)
        }

        val titleView = TextView(this).apply {
            text = getString(R.string.app_help_title)
            textSize = 20f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(android.graphics.Color.parseColor("#1E293B")) // slate-800
            setPadding(0, 0, 0, 24)
        }
        layout.addView(titleView)

        val scrollView = android.widget.ScrollView(this).apply {
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1.0f
            )
        }

        val bodyView = TextView(this).apply {
            val helpText = getString(R.string.app_help_body)
            text = Html.fromHtml(helpText, Html.FROM_HTML_MODE_COMPACT)
            textSize = 14f
            setTextColor(android.graphics.Color.parseColor("#475569")) // slate-600
        }
        
        scrollView.addView(bodyView)
        layout.addView(scrollView)

        val closeButton = Button(this).apply {
            text = "Back to Client"
            setTextColor(android.graphics.Color.WHITE)
            setBackgroundColor(android.graphics.Color.parseColor("#0F172A")) // slate-900
            setPadding(24, 12, 24, 12)
            setOnClickListener { finish() }
            val params = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = 24
            }
            layoutParams = params
        }
        layout.addView(closeButton)

        setContentView(layout)
    }
}
