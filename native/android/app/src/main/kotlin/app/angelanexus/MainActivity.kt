package app.angelanexus

import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.tooling.preview.Preview
import app.angelanexus.ui.AngelaNexusApp
import app.angelanexus.ui.theme.AngelaNexusTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AngelaNexusTheme(darkTheme = isSystemInDarkTheme()) {
                Surface(color = MaterialTheme.colorScheme.background) {
                    AngelaNexusRoot()
                }
            }
        }
    }
}

@Composable
private fun AngelaNexusRoot() {
    val context = LocalContext.current
    val darkTheme = isSystemInDarkTheme()
    var status by remember { mutableStateOf("ready") }

    val documentLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        status = if (uri != null) "config-selected" else "ready"
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }
        }
    }

    val vpnLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            context.startService(Intent(context, app.angelanexus.AngelaNexusVpnService::class.java))
            status = "vpn-boundary-started"
        }
    }

    AngelaNexusApp(
        darkTheme = darkTheme,
        onImportConfig = {
            status = "selecting-config"
            documentLauncher.launch(arrayOf("*/*"))
        },
        onStartVpn = {
            val intent = VpnService.prepare(context)
            if (intent == null) {
                context.startService(Intent(context, app.angelanexus.AngelaNexusVpnService::class.java))
                status = "vpn-boundary-started"
            } else {
                vpnLauncher.launch(intent)
            }
        }
    )

    if (LocalInspectionMode.current) {
        @Suppress("UNUSED_VARIABLE")
        val previewStatus = status
    }
}

@Preview(showBackground = true)
@Composable
private fun AngelaNexusPreview() {
    AngelaNexusTheme(darkTheme = false, dynamicColor = false) {
        AngelaNexusApp(
            darkTheme = false,
            onImportConfig = {},
            onStartVpn = {}
        )
    }
}
