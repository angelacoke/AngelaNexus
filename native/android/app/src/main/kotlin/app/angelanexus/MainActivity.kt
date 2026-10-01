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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.tooling.preview.Preview
import app.angelanexus.ui.AngelaNexusApp
import app.angelanexus.ui.theme.AngelaNexusTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AngelaNexusTheme(darkTheme = isSystemInDarkTheme()) {
                Surface(color = MaterialTheme.colorScheme.background) { AngelaNexusRoot() }
            }
        }
    }
}

@Composable
private fun AngelaNexusRoot() {
    val context = LocalContext.current
    val darkTheme = isSystemInDarkTheme()
    val scope = rememberCoroutineScope()
    val importPort = remember { PendingConfigImportPort() }
    val importCoordinator = remember { ConfigImportCoordinator(importPort) }
    val rootAdapter = remember { AndroidRootTransparentAdapter(context) }
    val rootCapabilities = remember { rootAdapter.inspect() }
    var selectedMode by remember { mutableStateOf(AndroidTransparentMode.AUTO) }
    var status by remember { mutableStateOf("ready") }

    val documentLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            status = "ready"
            return@rememberLauncherForActivityResult
        }
        status = "importing-config"
        scope.launch {
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    importCoordinator.importLocalFile(stream, uri.lastPathSegment)
                } ?: throw IllegalStateException("selected configuration cannot be opened")
            }.fold(
                onSuccess = { status = "config-staged" },
                onFailure = { status = "config-import-error" }
            )
        }
    }

    val vpnLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            context.startService(Intent(context, AngelaNexusVpnService::class.java))
            status = "vpn-boundary-started"
        }
    }

    fun startSelectedMode() {
        val mode = selectAndroidTransparentMode(selectedMode, rootCapabilities)
        if (mode == null) {
            status = "transparent-mode-unavailable"
            return
        }
        when (mode) {
            AndroidTransparentMode.ROOT -> {
                status = "root-mode-backend-pending"
            }
            AndroidTransparentMode.SYSTEM -> {
                val intent = VpnService.prepare(context)
                if (intent == null) {
                    status = "vpn-runtime-not-ready"
                } else {
                    vpnLauncher.launch(intent)
                }
            }
            AndroidTransparentMode.AUTO -> error("auto mode must resolve before startup")
        }
    }

    AngelaNexusApp(
        darkTheme = darkTheme,
        transparentMode = selectedMode,
        rootAvailable = rootCapabilities.rootAvailable && rootCapabilities.rootAuthorized,
        onTransparentModeChange = { selectedMode = it },
        onImportConfig = {
            status = "selecting-config"
            documentLauncher.launch(arrayOf("*/*"))
        },
        onStartVpn = ::startSelectedMode
    )

    if (LocalInspectionMode.current) {
        @Suppress("UNUSED_VARIABLE") val previewStatus = status
    }
}

@Preview(showBackground = true)
@Composable
private fun AngelaNexusPreview() {
    AngelaNexusTheme(darkTheme = false, dynamicColor = false) {
        AngelaNexusApp(
            darkTheme = false,
            transparentMode = AndroidTransparentMode.AUTO,
            rootAvailable = false,
            onTransparentModeChange = {},
            onImportConfig = {},
            onStartVpn = {}
        )
    }
}
