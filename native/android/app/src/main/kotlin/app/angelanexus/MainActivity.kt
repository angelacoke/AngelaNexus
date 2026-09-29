package app.angelanexus

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.VpnService
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private val openConfigRequest = 1001
    private val vpnRequest = 1002

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContent())
    }

    private fun buildContent(): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 56, 48, 48)
            setBackgroundColor(Color.WHITE)
        }

        val logo = ImageView(this).apply {
            setImageResource(R.drawable.angelanexus_logo)
            contentDescription = getString(R.string.app_name)
            adjustViewBounds = true
        }
        root.addView(logo, LinearLayout.LayoutParams(220, 220))

        val title = TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 30f
            setTextColor(Color.BLACK)
            gravity = Gravity.CENTER
        }
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val subtitle = TextView(this).apply {
            text = getString(R.string.app_subtitle)
            textSize = 15f
            setTextColor(Color.DKGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 12, 0, 28)
        }
        root.addView(subtitle, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val status = TextView(this).apply {
            text = getString(R.string.status_ready)
            textSize = 16f
            setTextColor(Color.DKGRAY)
            setPadding(0, 0, 0, 20)
        }
        root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        val importButton = Button(this).apply {
            text = getString(R.string.import_config)
            setOnClickListener { openConfigPicker(status) }
        }
        root.addView(importButton, buttonParams())

        val vpnButton = Button(this).apply {
            text = getString(R.string.test_vpn_boundary)
            setOnClickListener { requestVpnPermission(status) }
        }
        root.addView(vpnButton, buttonParams())

        val kernel = TextView(this).apply {
            text = getString(R.string.kernel_status)
            textSize = 14f
            setTextColor(Color.GRAY)
            setPadding(0, 24, 0, 0)
        }
        root.addView(kernel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        return root
    }

    private fun buttonParams(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply { bottomMargin = 12 }

    private fun openConfigPicker(status: TextView) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(intent, openConfigRequest)
        status.text = getString(R.string.status_select_config)
    }

    private fun requestVpnPermission(status: TextView) {
        val intent = VpnService.prepare(this)
        if (intent != null) {
            startActivityForResult(intent, vpnRequest)
        } else {
            startVpnService(status)
        }
    }

    private fun startVpnService(status: TextView) {
        startService(Intent(this, app.nexus.NexusVpnService::class.java))
        status.text = getString(R.string.status_vpn_boundary_started)
        Toast.makeText(this, R.string.vpn_boundary_notice, Toast.LENGTH_LONG).show()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == vpnRequest && resultCode == RESULT_OK) {
            val status = findStatusView()
            startVpnService(status)
        }
    }

    private fun findStatusView(): TextView {
        val root = window.decorView.findViewById<ViewGroup>(android.R.id.content)
        return root.findViewWithTag("status") ?: TextView(this)
    }
}
