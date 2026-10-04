package app.angelanexus

import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.os.Build
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
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.tooling.preview.Preview
import app.angelanexus.ui.AngelaNexusApp
import app.angelanexus.ui.theme.AngelaNexusTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: android.content.Context) {
        super.attachBaseContext(LocaleAwareContext(newBase))
    }

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
    val coreRuntimeTransport = remember {
        NativeCoreRuntimeTransport(context)
    }
    val importPort = remember { SerializedConfigImportPort(coreRuntimeTransport) }
    val importCoordinator = remember { ConfigImportCoordinator(importPort) }
    val rootAdapter = remember { AndroidRootTransparentAdapter(context) }
    val rootCapabilities = remember { rootAdapter.inspect() }
    var selectedMode by remember { mutableStateOf(AndroidTransparentMode.AUTO) }
    var status by remember { mutableStateOf(AndroidUiStatus.READY) }
    var importResult by remember { mutableStateOf<CoreRuntimeImportResult?>(null) }
    val executionState by AndroidKernelExecutionStateStore.state.collectAsState()

    val documentLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            status = AndroidUiStatus.READY
            return@rememberLauncherForActivityResult
        }
        status = AndroidUiStatus.IMPORTING_CONFIG
        scope.launch {
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                context.contentResolver.openInputStream(uri)?.use { stream ->
                    importCoordinator.importLocalFile(stream, uri.lastPathSegment)
                } ?: throw IllegalStateException("selected configuration cannot be opened")
            }.fold(
                onSuccess = { result ->
                    importResult = result
                    status = AndroidUiStatus.CONFIG_DELIVERED_TO_CORE
                },
                onFailure = {
                    importResult = null
                    status = AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE
                }
            )
        }
    }

    fun startVpnService(kernelId: String) {
        val intent = Intent(context, AngelaNexusVpnService::class.java)
            .setAction(AngelaNexusVpnService.ACTION_START)
            .putExtra(AngelaNexusVpnService.EXTRA_KERNEL_ID, kernelId)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    val vpnLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) {
            val kernelId = importResult?.kernel
            if (kernelId.isNullOrBlank()) {
                status = AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE
            } else {
                startVpnService(kernelId)
            }
        } else {
            status = AndroidUiStatus.VPN_RUNTIME_NOT_READY
        }
    }

    fun startSelectedMode() {
        val mode = selectAndroidTransparentMode(selectedMode, rootCapabilities)
        if (mode == null) {
            status = AndroidUiStatus.TRANSPARENT_MODE_UNAVAILABLE
            return
        }
        when (mode) {
            AndroidTransparentMode.ROOT -> {
                status = AndroidUiStatus.ROOT_MODE_BACKEND_PENDING
            }
            AndroidTransparentMode.SYSTEM -> {
                val kernelId = importResult?.kernel
                if (kernelId.isNullOrBlank()) {
                    status = AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE
                    return
                }
                val intent = VpnService.prepare(context)
                if (intent == null) {
                    startVpnService(kernelId)
                } else {
                    vpnLauncher.launch(intent)
                }
            }
            AndroidTransparentMode.AUTO -> error("auto mode must resolve before startup")
        }
    }

    val currentLocaleTag = remember {
        context.resources.configuration.locales[0].toLanguageTag().let { tag ->
            when {
                tag.equals("zh-CN", ignoreCase = true) || tag.startsWith("zh-", ignoreCase = true) -> "zh-CN"
                tag.startsWith("ru", ignoreCase = true) -> "ru"
                tag.startsWith("fa", ignoreCase = true) -> "fa"
                else -> "en"
            }
        }
    }

    AngelaNexusApp(
        darkTheme = darkTheme,
        transparentMode = selectedMode,
        rootAvailable = rootCapabilities.rootAvailable && rootCapabilities.rootAuthorized,
        importResult = importResult,
        executionState = executionState,
        onTransparentModeChange = { selectedMode = it },
        onImportConfig = {
            status = AndroidUiStatus.SELECTING_CONFIG
            documentLauncher.launch(arrayOf("*/*"))
        },
        onStartVpn = ::startSelectedMode,
        currentLocaleTag = currentLocaleTag,
        onLocaleSelected = { tag ->
            if (tag == null) {
                AndroidLocalePreference.clear(context)
            } else {
                AndroidLocalePreference.save(context, tag)
            }
            (context as? MainActivity)?.recreate()
        }
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
            importResult = null,
            executionState = KernelExecutionState(),
            onTransparentModeChange = {},
            onImportConfig = {},
            onStartVpn = {},
            currentLocaleTag = "en",
            onLocaleSelected = {}
        )
    }
}
