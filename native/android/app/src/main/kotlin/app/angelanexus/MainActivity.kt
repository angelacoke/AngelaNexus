package app.angelanexus

import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
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
import java.io.ByteArrayInputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) {
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
        NativeCoreRuntimeTransport(AndroidJavaScriptCoreRuntimeBridge(context))
    }
    val importPort = remember { SerializedConfigImportPort(coreRuntimeTransport) }
    val importCoordinator = remember { ConfigImportCoordinator(importPort) }
    val profileStore = remember { AndroidEncryptedProfileStore(context.applicationContext) }
    val rootAdapter = remember { AndroidRootTransparentAdapter(context) }
    val rootCapabilities = remember { rootAdapter.inspect() }
    var selectedMode by remember { mutableStateOf(AndroidTransparentMode.AUTO) }
    var status by remember { mutableStateOf(AndroidUiStatus.READY) }
    var importResult by remember { mutableStateOf<CoreRuntimeImportResult?>(null) }
    var profileSnapshot by remember { mutableStateOf(AndroidProfileStoreSnapshot()) }
    var loadedProfileId by remember { mutableStateOf<String?>(null) }
    var importedProfileName by remember { mutableStateOf<String?>(null) }
    var profileFailure by remember { mutableStateOf<AndroidProfileStoreFailure?>(null) }
    var profilesLoading by remember { mutableStateOf(true) }
    var profileOperationPending by remember { mutableStateOf(false) }
    var vpnAuthorizationPending by remember { mutableStateOf(false) }
    val executionState by AndroidKernelExecutionStateStore.state.collectAsState()
    val runtimeBusy = vpnAuthorizationPending || executionState.phase in setOf(
        KernelExecutionPhase.STARTING,
        KernelExecutionPhase.RUNNING,
        KernelExecutionPhase.STOPPING,
    ) || (executionState.phase == KernelExecutionPhase.FAILED && executionState.cleanupRequired)
    val profileActionsEnabled = !runtimeBusy && !profileOperationPending && !profilesLoading

    fun setProfileFailure(error: Throwable) {
        val failure = (error as? AndroidProfileStoreException)?.failure
            ?: AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE
        profileFailure = failure
        if (failure == AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE) {
            status = AndroidUiStatus.PROFILE_STORAGE_UNAVAILABLE
        }
    }

    fun statusFor(result: CoreRuntimeImportResult) {
        status = if (result.hasExecutableAndroidExecutionHandoff()) {
            AndroidUiStatus.CONFIG_DELIVERED_TO_CORE
        } else {
            AndroidUiStatus.CONFIG_NOT_STARTABLE
        }
    }

    fun reportProfileActionBlocked() {
        status = if (runtimeBusy) {
            AndroidUiStatus.PROFILE_CHANGE_REQUIRES_STOP
        } else {
            AndroidUiStatus.PROFILE_OPERATION_IN_PROGRESS
        }
    }

    LaunchedEffect(profileStore, importCoordinator) {
        try {
            val snapshot = withContext(Dispatchers.IO) { profileStore.snapshot() }
            profileSnapshot = snapshot
            val activeId = snapshot.activeProfileId
            if (activeId != null) {
                val profile = snapshot.profiles.firstOrNull { it.id == activeId }
                    ?: throw AndroidProfileStoreException(AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE)
                val configBytes = withContext(Dispatchers.IO) {
                    profileStore.loadConfigurationBytes(activeId)
                }
                status = AndroidUiStatus.IMPORTING_CONFIG
                val result = try {
                    importCoordinator.importLocalFile(ByteArrayInputStream(configBytes), profile.name)
                } catch (_: Exception) {
                    status = AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE
                    return@LaunchedEffect
                } finally {
                    configBytes.fill(0)
                }
                importResult = result
                loadedProfileId = profile.id
                importedProfileName = profile.name
                statusFor(result)
            }
        } catch (error: Exception) {
            setProfileFailure(error)
        } finally {
            profilesLoading = false
        }
    }

    val documentLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) {
            status = AndroidUiStatus.READY
            return@rememberLauncherForActivityResult
        }
        if (!profileActionsEnabled) {
            reportProfileActionBlocked()
            return@rememberLauncherForActivityResult
        }
        status = AndroidUiStatus.IMPORTING_CONFIG
        profileFailure = null
        val sourceName = resolveDisplayName(context, uri) ?: context.getString(R.string.default_profile_name)
        profileOperationPending = true
        scope.launch {
            try {
                val result = context.contentResolver.openInputStream(uri)?.use { stream ->
                    importCoordinator.importLocalFile(stream, sourceName)
                } ?: throw IllegalStateException("selected configuration cannot be opened")
                importResult = result
                loadedProfileId = null
                importedProfileName = sourceName
                statusFor(result)
            } catch (_: Exception) {
                importResult = null
                loadedProfileId = null
                importedProfileName = null
                status = AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE
            } finally {
                profileOperationPending = false
            }
        }
    }

    fun startVpnService(kernelId: String) {
        val handoff = importResult
        if (handoff?.kernel != kernelId || !handoff.hasExecutableAndroidExecutionHandoff()) {
            status = AndroidUiStatus.CONFIG_NOT_STARTABLE
            return
        }
        val handoffToken = runCatching { AndroidRuntimeHandoffStore.publish(handoff) }
            .getOrElse {
                status = AndroidUiStatus.CONFIG_NOT_STARTABLE
                return
            }
        val intent = Intent(context, AngelaNexusVpnService::class.java)
            .setAction(AngelaNexusVpnService.ACTION_START)
            .putExtra(AngelaNexusVpnService.EXTRA_HANDOFF_TOKEN, handoffToken)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }.onFailure {
            AndroidRuntimeHandoffStore.discard(handoffToken)
            status = AndroidUiStatus.VPN_RUNTIME_NOT_READY
        }
    }

    fun stopVpnService() {
        context.startService(
            Intent(context, AngelaNexusVpnService::class.java)
                .setAction(AngelaNexusVpnService.ACTION_STOP),
        )
    }

    val vpnLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        vpnAuthorizationPending = false
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
        if (profilesLoading || profileOperationPending) {
            status = AndroidUiStatus.PROFILE_OPERATION_IN_PROGRESS
            return
        }
        if (!importResult.hasExecutableAndroidExecutionHandoff()) {
            status = AndroidUiStatus.CONFIG_NOT_STARTABLE
            return
        }
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
                    vpnAuthorizationPending = true
                    vpnLauncher.launch(intent)
                }
            }
            AndroidTransparentMode.AUTO -> error("auto mode must resolve before startup")
        }
    }

    fun saveCurrentProfile(name: String) {
        if (!profileActionsEnabled) {
            reportProfileActionBlocked()
            return
        }
        val configuration = importResult?.configuration
        if (configuration.isNullOrBlank()) {
            profileFailure = AndroidProfileStoreFailure.INVALID_CONFIGURATION
            return
        }
        profileFailure = null
        profileOperationPending = true
        scope.launch {
            try {
                val saved = withContext(Dispatchers.IO) {
                    profileStore.saveProfile(name, configuration)
                }
                profileSnapshot = profileSnapshot.copy(
                    profiles = profileSnapshot.profiles + saved,
                    activeProfileId = saved.id,
                )
                loadedProfileId = saved.id
                importedProfileName = saved.name
            } catch (error: Exception) {
                setProfileFailure(error)
            } finally {
                profileOperationPending = false
            }
        }
    }

    fun selectProfile(profileId: String) {
        if (!profileActionsEnabled) {
            reportProfileActionBlocked()
            return
        }
        val profile = profileSnapshot.profiles.firstOrNull { it.id == profileId }
        if (profile == null) {
            setProfileFailure(AndroidProfileStoreException(AndroidProfileStoreFailure.PROFILE_NOT_FOUND))
            return
        }
        profileFailure = null
        importResult = null
        loadedProfileId = null
        importedProfileName = null
        status = AndroidUiStatus.IMPORTING_CONFIG
        profileOperationPending = true
        scope.launch {
            try {
                val configBytes = withContext(Dispatchers.IO) {
                    profileStore.loadConfigurationBytes(profileId)
                }
                val result = try {
                    importCoordinator.importLocalFile(ByteArrayInputStream(configBytes), profile.name)
                } finally {
                    configBytes.fill(0)
                }
                val updated = withContext(Dispatchers.IO) {
                    profileStore.setActiveProfile(profileId)
                }
                profileSnapshot = updated
                importResult = result
                loadedProfileId = profile.id
                importedProfileName = profile.name
                statusFor(result)
            } catch (error: AndroidProfileStoreException) {
                importResult = null
                loadedProfileId = null
                importedProfileName = null
                setProfileFailure(error)
            } catch (_: Exception) {
                importResult = null
                loadedProfileId = null
                importedProfileName = null
                status = AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE
            } finally {
                profileOperationPending = false
            }
        }
    }

    fun renameProfile(profileId: String, name: String) {
        if (!profileActionsEnabled) {
            reportProfileActionBlocked()
            return
        }
        profileFailure = null
        profileOperationPending = true
        scope.launch {
            try {
                profileSnapshot = withContext(Dispatchers.IO) {
                    profileStore.renameProfile(profileId, name)
                }
                if (loadedProfileId == profileId) importedProfileName = name.trim()
            } catch (error: Exception) {
                setProfileFailure(error)
            } finally {
                profileOperationPending = false
            }
        }
    }

    fun deleteProfile(profileId: String) {
        if (!profileActionsEnabled) {
            reportProfileActionBlocked()
            return
        }
        profileFailure = null
        profileOperationPending = true
        scope.launch {
            try {
                profileSnapshot = withContext(Dispatchers.IO) {
                    profileStore.deleteProfile(profileId)
                }
                if (loadedProfileId == profileId) {
                    importResult = null
                    loadedProfileId = null
                    importedProfileName = null
                    status = AndroidUiStatus.READY
                }
            } catch (error: Exception) {
                setProfileFailure(error)
            } finally {
                profileOperationPending = false
            }
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
        uiStatus = status,
        onTransparentModeChange = { selectedMode = it },
        onImportConfig = {
            if (!profileActionsEnabled) {
                reportProfileActionBlocked()
            } else {
                profileFailure = null
                status = AndroidUiStatus.SELECTING_CONFIG
                documentLauncher.launch(arrayOf("*/*"))
            }
        },
        onStartVpn = ::startSelectedMode,
        onStopVpn = ::stopVpnService,
        currentLocaleTag = currentLocaleTag,
        onLocaleSelected = { tag ->
            if (tag == null) {
                AndroidLocalePreference.clear(context)
            } else {
                AndroidLocalePreference.save(context, tag)
            }
            (context as? MainActivity)?.recreate()
        },
        profiles = profileSnapshot.profiles,
        activeProfileId = profileSnapshot.activeProfileId,
        loadedProfileId = loadedProfileId,
        importedProfileName = importedProfileName,
        profileFailure = profileFailure,
        profilesLoading = profilesLoading,
        profileActionsEnabled = profileActionsEnabled,
        profileOperationPending = profilesLoading || profileOperationPending,
        onSaveProfile = ::saveCurrentProfile,
        onSelectProfile = ::selectProfile,
        onRenameProfile = ::renameProfile,
        onDeleteProfile = ::deleteProfile,
    )

    if (LocalInspectionMode.current) {
        @Suppress("UNUSED_VARIABLE") val previewStatus = status
    }
}

private fun resolveDisplayName(context: Context, uri: Uri): String? {
    val queried = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor: Cursor ->
            if (cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) cursor.getString(index) else null
            } else {
                null
            }
        }
    }.getOrNull()
    return queried?.takeIf { it.isNotBlank() }
        ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() }
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
            uiStatus = AndroidUiStatus.READY,
            onTransparentModeChange = {},
            onImportConfig = {},
            onStartVpn = {},
            onStopVpn = {},
            currentLocaleTag = "en",
            onLocaleSelected = {},
        )
    }
}
