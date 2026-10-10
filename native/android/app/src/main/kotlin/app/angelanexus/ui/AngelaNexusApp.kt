package app.angelanexus.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.angelanexus.AndroidTransparentMode
import app.angelanexus.AndroidUiStatus
import app.angelanexus.AndroidRoutingExecutionIntent
import app.angelanexus.AndroidEncryptedProfileStore
import app.angelanexus.AndroidLocalProfileSummary
import app.angelanexus.AndroidProfileStoreFailure
import app.angelanexus.CoreNodeSummary
import app.angelanexus.CoreRuntimeImportResult
import app.angelanexus.KernelExecutionPhase
import app.angelanexus.KernelExecutionState
import app.angelanexus.canStartAndroidRuntime
import app.angelanexus.R

private data class AppDestination(val label: Int, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val destinations = listOf(
    AppDestination(R.string.nav_home, Icons.Default.Home), AppDestination(R.string.nav_profiles, Icons.Default.CloudDownload),
    AppDestination(R.string.nav_proxies, Icons.Default.Dns), AppDestination(R.string.nav_rules, Icons.Default.List), AppDestination(R.string.nav_settings, Icons.Default.Settings)
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AngelaNexusApp(
    darkTheme: Boolean,
    transparentMode: AndroidTransparentMode,
    rootAvailable: Boolean,
    importResult: CoreRuntimeImportResult?,
    executionState: KernelExecutionState,
    availableProxyKernelIds: Set<String>,
    uiStatus: AndroidUiStatus,
    onTransparentModeChange: (AndroidTransparentMode) -> Unit,
    onImportConfig: () -> Unit,
    onStartVpn: () -> Unit,
    onStopVpn: () -> Unit,
    currentLocaleTag: String,
    onLocaleSelected: (String?) -> Unit,
    profiles: List<AndroidLocalProfileSummary> = emptyList(),
    activeProfileId: String? = null,
    loadedProfileId: String? = null,
    importedProfileName: String? = null,
    profileFailure: AndroidProfileStoreFailure? = null,
    profilesLoading: Boolean = false,
    profileActionsEnabled: Boolean = true,
    profileOperationPending: Boolean = false,
    onSaveProfile: (String) -> Unit = {},
    onSelectProfile: (String) -> Unit = {},
    onRenameProfile: (String, String) -> Unit = { _, _ -> },
    onDeleteProfile: (String) -> Unit = {},
) {
    var selected by rememberSaveable { mutableIntStateOf(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val useNavigationRail = shouldUseNavigationRail(maxWidth.value.toInt())
        Scaffold(
            topBar = { TopAppBar(title = { Row(verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(R.drawable.angelanexus_logo), null, Modifier.size(34.dp))
                Spacer(Modifier.width(10.dp)); Column { Text(stringResource(R.string.app_name), fontWeight = FontWeight.SemiBold); Text(stringResource(R.string.app_subtitle), style = MaterialTheme.typography.labelSmall) }
            }}) },
            bottomBar = {
                if (!useNavigationRail) {
                    NavigationBar { destinations.forEachIndexed { index, destination ->
                        NavigationBarItem(selected == index, { selected = index }, { Icon(destination.icon, stringResource(destination.label)) }, label = { Text(stringResource(destination.label)) })
                    } }
                }
            },
        ) { padding ->
            Row(Modifier.fillMaxSize().padding(padding)) {
                if (useNavigationRail) {
                    NavigationRail {
                        destinations.forEachIndexed { index, destination ->
                            NavigationRailItem(
                                selected = selected == index,
                                onClick = { selected = index },
                                icon = { Icon(destination.icon, stringResource(destination.label)) },
                                label = { Text(stringResource(destination.label)) },
                                alwaysShowLabel = true,
                            )
                        }
                    }
                }
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    RuntimeStatusBanner(uiStatus, executionState)
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        when (selected) {
                            0 -> HomeScreen(PaddingValues(0.dp), transparentMode, rootAvailable, importResult, executionState, availableProxyKernelIds, uiStatus, onTransparentModeChange, onImportConfig, onStartVpn, onStopVpn, profileOperationPending)
                            1 -> ProfilesScreen(
                                padding = PaddingValues(0.dp),
                                onImport = onImportConfig,
                                result = importResult,
                                profiles = profiles,
                                activeProfileId = activeProfileId,
                                loadedProfileId = loadedProfileId,
                                importedProfileName = importedProfileName,
                                profileFailure = profileFailure,
                                profilesLoading = profilesLoading,
                                profileActionsEnabled = profileActionsEnabled,
                                onSaveProfile = onSaveProfile,
                                onSelectProfile = onSelectProfile,
                                onRenameProfile = onRenameProfile,
                                onDeleteProfile = onDeleteProfile,
                            )
                            2 -> ProxiesScreen(PaddingValues(0.dp), importResult, onImportConfig)
                            3 -> RulesScreen(PaddingValues(0.dp), importResult)
                            else -> SettingsScreen(PaddingValues(0.dp), darkTheme, currentLocaleTag, onLocaleSelected)
                        }
                    }
                }
            }
        )
    }
}

@Composable
private fun RuntimeStatusBanner(status: AndroidUiStatus, executionState: KernelExecutionState) {
    val operationMessage = when (status) {
        AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE -> R.string.status_core_unavailable to true
        AndroidUiStatus.CONFIG_NOT_STARTABLE -> R.string.status_config_not_startable to true
        AndroidUiStatus.KERNEL_RUNTIME_UNAVAILABLE -> R.string.status_kernel_runtime_unavailable to true
        AndroidUiStatus.VPN_RUNTIME_NOT_READY -> R.string.status_vpn_not_ready to true
        AndroidUiStatus.PROFILE_STORAGE_UNAVAILABLE -> R.string.status_profile_storage_unavailable to true
        AndroidUiStatus.PROFILE_CHANGE_REQUIRES_STOP -> R.string.status_profile_change_requires_stop to true
        AndroidUiStatus.PROFILE_OPERATION_IN_PROGRESS -> R.string.status_profile_operation_in_progress to false
        AndroidUiStatus.TRANSPARENT_MODE_UNAVAILABLE -> R.string.status_transparent_unavailable to true
        AndroidUiStatus.ROOT_MODE_BACKEND_PENDING -> R.string.status_root_pending to true
        else -> null
    }
    val (message, isError) = operationMessage ?: when (executionState.phase) {
        KernelExecutionPhase.STARTING -> R.string.runtime_status_starting to false
        KernelExecutionPhase.RUNNING -> R.string.runtime_status_running to false
        KernelExecutionPhase.STOPPING -> R.string.runtime_status_stopping to false
        KernelExecutionPhase.FAILED -> if (executionState.cleanupRequired) {
            R.string.runtime_status_cleanup_required to true
        } else {
            R.string.runtime_status_failed to true
        }
        KernelExecutionPhase.STOPPED -> R.string.runtime_status_stopped to false
        else -> when (status) {
            AndroidUiStatus.READY -> R.string.status_ready to false
            AndroidUiStatus.SELECTING_CONFIG -> R.string.status_select_config to false
            AndroidUiStatus.IMPORTING_CONFIG -> R.string.status_importing_config to false
            AndroidUiStatus.CONFIG_DELIVERED_TO_CORE -> R.string.status_config_delivered to false
            AndroidUiStatus.CONFIG_NOT_STARTABLE -> R.string.status_config_not_startable to true
            AndroidUiStatus.KERNEL_RUNTIME_UNAVAILABLE -> R.string.status_kernel_runtime_unavailable to true
            AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE -> R.string.status_core_unavailable to true
            AndroidUiStatus.PROFILE_STORAGE_UNAVAILABLE -> R.string.status_profile_storage_unavailable to true
            AndroidUiStatus.PROFILE_CHANGE_REQUIRES_STOP -> R.string.status_profile_change_requires_stop to true
            AndroidUiStatus.PROFILE_OPERATION_IN_PROGRESS -> R.string.status_profile_operation_in_progress to false
            AndroidUiStatus.VPN_RUNTIME_NOT_READY -> R.string.status_vpn_not_ready to true
            AndroidUiStatus.TRANSPARENT_MODE_UNAVAILABLE -> R.string.status_transparent_unavailable to true
            AndroidUiStatus.ROOT_MODE_BACKEND_PENDING -> R.string.status_root_pending to true
        }
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant,
        contentColor = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Text(
            text = stringResource(message),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun HomeScreen(
    padding: PaddingValues,
    mode: AndroidTransparentMode,
    rootAvailable: Boolean,
    importResult: CoreRuntimeImportResult?,
    executionState: KernelExecutionState,
    availableProxyKernelIds: Set<String>,
    uiStatus: AndroidUiStatus,
    onMode: (AndroidTransparentMode) -> Unit,
    onImport: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    profileOperationPending: Boolean,
) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ConnectionCard(mode, rootAvailable, importResult, executionState, availableProxyKernelIds, uiStatus, onMode, onStart, onStop, profileOperationPending) }
        item { TrafficCard() }
        item { SectionTitle(R.string.section_environment); EnvironmentCard(importResult, executionState) }
        item { SectionTitle(R.string.section_quick_actions); QuickActions(onImport) }
        item { SectionTitle(R.string.section_runtime); RuntimeCard(importResult, executionState) }
    }
}

@Composable
private fun ConnectionCard(
    mode: AndroidTransparentMode,
    rootAvailable: Boolean,
    importResult: CoreRuntimeImportResult?,
    executionState: KernelExecutionState,
    availableProxyKernelIds: Set<String>,
    uiStatus: AndroidUiStatus,
    onMode: (AndroidTransparentMode) -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
    profileOperationPending: Boolean,
) {
    val phase = executionState.phase
    val activeOrCleaning = phase == KernelExecutionPhase.STARTING ||
        phase == KernelExecutionPhase.RUNNING ||
        phase == KernelExecutionPhase.STOPPING ||
        (phase == KernelExecutionPhase.FAILED && executionState.cleanupRequired)
    val canStart = canStartAndroidRuntime(executionState, importResult, availableProxyKernelIds) && !profileOperationPending
    ElevatedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.transparent_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.transparent_description), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(connectionPhaseLabel(phase, executionState.cleanupRequired)), style = MaterialTheme.typography.titleMedium)
            listOf(AndroidTransparentMode.AUTO, AndroidTransparentMode.SYSTEM, AndroidTransparentMode.ROOT).forEach { option ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    RadioButton(selected = mode == option, onClick = { if (!activeOrCleaning && !profileOperationPending && (option != AndroidTransparentMode.ROOT || rootAvailable)) onMode(option) }, enabled = !activeOrCleaning && !profileOperationPending && (option != AndroidTransparentMode.ROOT || rootAvailable))
                    Column { Text(when(option) { AndroidTransparentMode.AUTO -> stringResource(R.string.mode_auto); AndroidTransparentMode.SYSTEM -> stringResource(R.string.mode_system); AndroidTransparentMode.ROOT -> stringResource(R.string.mode_root) }); if (option == AndroidTransparentMode.ROOT && !rootAvailable) Text(stringResource(R.string.root_unavailable), style = MaterialTheme.typography.labelSmall) }
                }
            }
            when {
                phase == KernelExecutionPhase.STOPPING -> Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Stop, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.runtime_action_stopping))
                }
                phase == KernelExecutionPhase.STARTING || phase == KernelExecutionPhase.RUNNING -> Button(onClick = onStop, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Stop, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.stop_transparent))
                }
                phase == KernelExecutionPhase.FAILED && executionState.cleanupRequired -> Button(onClick = onStop, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Stop, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.retry_cleanup))
                }
                else -> Button(onClick = onStart, enabled = canStart, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(8.dp))
                    Text(stringResource(if (phase == KernelExecutionPhase.FAILED) R.string.retry_start else R.string.start_transparent))
                }
            }
            if (profileOperationPending && !activeOrCleaning) {
                Text(stringResource(R.string.status_profile_operation_in_progress), style = MaterialTheme.typography.bodySmall)
            } else if (!canStart && !activeOrCleaning) {
                Text(
                    stringResource(
                        if (uiStatus == AndroidUiStatus.KERNEL_RUNTIME_UNAVAILABLE) {
                            R.string.status_kernel_runtime_unavailable
                        } else {
                            R.string.start_requires_config
                        },
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable private fun TrafficCard() { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text(stringResource(R.string.traffic_title), fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(12.dp)); Text(stringResource(R.string.traffic_idle)) } } }
@Composable private fun EnvironmentCard(result: CoreRuntimeImportResult?, state: KernelExecutionState) {
    val kernel = if (state.phase == KernelExecutionPhase.RUNNING) state.kernelId else result?.kernel
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            InfoRow(R.string.route_policy, stringResource(R.string.status_not_reported))
            InfoRow(R.string.leak_prevention, stringResource(R.string.status_not_reported))
            InfoRow(R.string.gfw_awareness, stringResource(R.string.status_not_verified))
            InfoRow(R.string.kernels, kernel ?: stringResource(R.string.kernel_not_selected))
        }
    }
}
@Composable private fun QuickActions(onImport: () -> Unit) { FilledTonalButton(onClick = onImport, Modifier.fillMaxWidth()) { Icon(Icons.Default.ImportExport, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.import_config)) } }
@Composable private fun RuntimeCard(result: CoreRuntimeImportResult?, executionState: KernelExecutionState) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.runtime_title), fontWeight = FontWeight.SemiBold)
            Text(stringResource(R.string.runtime_phase_label, stringResource(runtimePhaseLabel(executionState.phase))))
            executionState.kernelId?.let { Text("Execution kernel: $it") }
            executionState.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            if (executionState.cleanupRequired) Text(stringResource(R.string.runtime_status_cleanup_required), style = MaterialTheme.typography.bodySmall)
            if (result == null) {
                Text(stringResource(R.string.runtime_description), style = MaterialTheme.typography.bodySmall)
            } else {
                Text(stringResource(R.string.import_result_ready), style = MaterialTheme.typography.bodySmall)
                Text(stringResource(R.string.import_result_kernel, result.kernel ?: stringResource(R.string.unknown_value)))
                Text(stringResource(R.string.import_result_nodes, result.nodeCount))
                result.source?.let { Text(stringResource(R.string.import_result_source, it)) }
            }
        }
    }
}
@Composable
private fun ProfilesScreen(
    padding: PaddingValues,
    onImport: () -> Unit,
    result: CoreRuntimeImportResult?,
    profiles: List<AndroidLocalProfileSummary>,
    activeProfileId: String?,
    loadedProfileId: String?,
    importedProfileName: String?,
    profileFailure: AndroidProfileStoreFailure?,
    profilesLoading: Boolean,
    profileActionsEnabled: Boolean,
    onSaveProfile: (String) -> Unit,
    onSelectProfile: (String) -> Unit,
    onRenameProfile: (String, String) -> Unit,
    onDeleteProfile: (String) -> Unit,
) {
    var saveDialogOpen by remember { mutableStateOf(false) }
    var saveName by remember { mutableStateOf("") }
    var renameTarget by remember { mutableStateOf<AndroidLocalProfileSummary?>(null) }
    var renameName by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<AndroidLocalProfileSummary?>(null) }
    var invalidName by remember { mutableStateOf(false) }
    val saveableConfiguration = !result?.configuration.isNullOrBlank()

    LazyColumn(
        Modifier.fillMaxSize().padding(padding),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { PageHeader(R.string.nav_profiles, R.string.profiles_description) }
        item { ProfileCard(R.string.profile_storage_notice_title, R.string.profile_storage_notice) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = onImport,
                    enabled = profileActionsEnabled,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(stringResource(R.string.add_config)) }
                if (result != null && loadedProfileId == null && saveableConfiguration) {
                    OutlinedButton(
                        onClick = {
                            saveName = importedProfileName.orEmpty()
                            invalidName = false
                            saveDialogOpen = true
                        },
                        enabled = profileActionsEnabled,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(R.string.save_current_profile)) }
                }
                if (!profileActionsEnabled) {
                    Text(stringResource(R.string.profile_action_locked), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (profileFailure != null) {
            item {
                Text(
                    stringResource(profileFailureLabel(profileFailure)),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        if (result != null) {
            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            stringResource(R.string.profile_imported_as, importedProfileName ?: stringResource(R.string.default_profile_name)),
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(stringResource(R.string.profile_loaded_label, stringResource(if (loadedProfileId == null) R.string.profile_unsaved else R.string.profile_loaded)))
                        Text(stringResource(R.string.import_result_kernel, result.kernel ?: stringResource(R.string.unknown_value)))
                        Text(stringResource(R.string.import_result_nodes, result.nodeCount))
                        result.source?.let { Text(stringResource(R.string.import_result_source, it)) }
                    }
                }
            }
        }
        if (profilesLoading) {
            item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        } else if (profiles.isEmpty()) {
            item { ProfileCard(R.string.no_profiles, R.string.profile_support) }
        } else {
            items(profiles, key = { it.id }) { profile ->
                SavedProfileCard(
                    profile = profile,
                    activeProfileId = activeProfileId,
                    loadedProfileId = loadedProfileId,
                    actionsEnabled = profileActionsEnabled,
                    onSelect = { onSelectProfile(profile.id) },
                    onRename = {
                        renameName = profile.name
                        invalidName = false
                        renameTarget = profile
                    },
                    onDelete = { deleteTarget = profile },
                )
            }
        }
    }

    if (saveDialogOpen) {
        AlertDialog(
            onDismissRequest = { saveDialogOpen = false },
            title = { Text(stringResource(R.string.profile_save_title)) },
            text = {
                OutlinedTextField(
                    value = saveName,
                    onValueChange = { saveName = it; invalidName = false },
                    label = { Text(stringResource(R.string.profile_name_label)) },
                    singleLine = true,
                    isError = invalidName,
                    supportingText = if (invalidName) {
                        { Text(stringResource(R.string.profile_name_invalid)) }
                    } else null,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (!isValidProfileName(saveName)) {
                        invalidName = true
                    } else {
                        onSaveProfile(saveName.trim())
                        saveDialogOpen = false
                    }
                }) { Text(stringResource(R.string.save)) }
            },
            dismissButton = { TextButton(onClick = { saveDialogOpen = false }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }

    renameTarget?.let { profile ->
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            title = { Text(stringResource(R.string.profile_rename_title)) },
            text = {
                OutlinedTextField(
                    value = renameName,
                    onValueChange = { renameName = it; invalidName = false },
                    label = { Text(stringResource(R.string.profile_name_label)) },
                    singleLine = true,
                    isError = invalidName,
                    supportingText = if (invalidName) {
                        { Text(stringResource(R.string.profile_name_invalid)) }
                    } else null,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (!isValidProfileName(renameName)) {
                        invalidName = true
                    } else {
                        onRenameProfile(profile.id, renameName.trim())
                        renameTarget = null
                    }
                }) { Text(stringResource(R.string.save)) }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }

    deleteTarget?.let { profile ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text(stringResource(R.string.profile_delete_title)) },
            text = { Text(stringResource(R.string.profile_delete_message, profile.name)) },
            confirmButton = {
                TextButton(
                    onClick = { onDeleteProfile(profile.id); deleteTarget = null },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.delete)) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }
}

@Composable
private fun SavedProfileCard(
    profile: AndroidLocalProfileSummary,
    activeProfileId: String?,
    loadedProfileId: String?,
    actionsEnabled: Boolean,
    onSelect: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(profile.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            when (profile.id) {
                loadedProfileId -> Text(stringResource(R.string.profile_loaded), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                activeProfileId -> Text(stringResource(R.string.profile_restore_on_launch), style = MaterialTheme.typography.labelMedium)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(
                    onClick = onSelect,
                    enabled = actionsEnabled && profile.id != loadedProfileId,
                    modifier = Modifier.weight(1f),
                ) { Text(stringResource(if (profile.id == loadedProfileId) R.string.profile_loaded else R.string.profile_use), maxLines = 1) }
                TextButton(onClick = onRename, enabled = actionsEnabled, modifier = Modifier.weight(1f)) {
                    Text(stringResource(R.string.rename), maxLines = 1)
                }
            }
            TextButton(
                onClick = onDelete,
                enabled = actionsEnabled,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text(stringResource(R.string.delete)) }
        }
    }
}

private fun profileFailureLabel(failure: AndroidProfileStoreFailure): Int = when (failure) {
    AndroidProfileStoreFailure.INVALID_NAME -> R.string.profile_name_invalid
    AndroidProfileStoreFailure.INVALID_CONFIGURATION -> R.string.profile_configuration_invalid
    AndroidProfileStoreFailure.CONFIG_TOO_LARGE -> R.string.profile_configuration_too_large
    AndroidProfileStoreFailure.DUPLICATE_NAME -> R.string.profile_name_duplicate
    AndroidProfileStoreFailure.PROFILE_LIMIT -> R.string.profile_limit_reached
    AndroidProfileStoreFailure.PROFILE_NOT_FOUND -> R.string.profile_not_found
    AndroidProfileStoreFailure.CORRUPT_OR_UNAVAILABLE -> R.string.status_profile_storage_unavailable
}

private fun isValidProfileName(name: String): Boolean {
    val normalized = name.trim()
    return normalized.isNotEmpty() &&
        normalized.length <= AndroidEncryptedProfileStore.MAX_PROFILE_NAME_LENGTH &&
        normalized.none { Character.isISOControl(it) }
}

@Composable
private fun ProxiesScreen(padding: PaddingValues, result: CoreRuntimeImportResult?, onImport: () -> Unit) {
    val summaries = result?.nodeSummaries.orEmpty()
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader(R.string.nav_proxies, R.string.proxies_description) }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (result == null) {
                        Text(stringResource(R.string.proxy_no_import), style = MaterialTheme.typography.bodyMedium)
                        FilledTonalButton(onClick = onImport) { Text(stringResource(R.string.add_config)) }
                    } else {
                        Text(stringResource(R.string.import_result_ready), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.import_result_nodes, result.nodeCount))
                        Text(stringResource(R.string.import_result_kernel, result.kernel ?: stringResource(R.string.unknown_value)))
                        if (summaries.isEmpty()) {
                            Text(
                                stringResource(if (result.nodeCount == 0) R.string.proxy_nodes_empty else R.string.proxy_details_unavailable),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        } else {
                            Text(stringResource(R.string.proxy_nodes_section), style = MaterialTheme.typography.titleSmall)
                            if (result.nodeSummariesTruncated) {
                                Text(
                                    stringResource(R.string.proxy_nodes_truncated, summaries.size, result.nodeCount),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        }
        itemsIndexed(summaries) { _, summary -> NodeSummaryCard(summary) }
    }
}

@Composable
private fun NodeSummaryCard(summary: CoreNodeSummary) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = summary.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            summary.protocol?.let { NodeDetail(R.string.proxy_protocol, it) }
            summary.server?.let { NodeDetail(R.string.proxy_server, it) }
            summary.port?.let { NodeDetail(R.string.proxy_port, it.toString()) }
        }
    }
}

@Composable
private fun NodeDetail(label: Int, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(stringResource(label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun RulesScreen(padding: PaddingValues, result: CoreRuntimeImportResult?) {
    val routingIntent = remember(result?.executionIntentJson) {
        result?.executionIntentJson?.let { serialized ->
            runCatching { AndroidRoutingExecutionIntent.parse(serialized) }.getOrNull()
        }
    }
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader(R.string.nav_rules, R.string.rules_description) }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.rules_intent_preview), fontWeight = FontWeight.SemiBold)
                    when {
                        result == null -> Text(stringResource(R.string.rules_no_intent))
                        routingIntent == null -> Text(stringResource(R.string.status_not_verified))
                        else -> {
                            InfoRow(R.string.route_policy, "${routingIntent.mode} · ${routingIntent.action}")
                            routingIntent.target?.let { target ->
                                Column {
                                    Text(stringResource(R.string.route_target), style = MaterialTheme.typography.labelMedium)
                                    Text(target, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            Text(stringResource(R.string.status_not_reported), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
@Composable
private fun SettingsScreen(
    padding: PaddingValues,
    darkTheme: Boolean,
    currentLocaleTag: String,
    onLocaleSelected: (String?) -> Unit
) {
    var languageDialog by remember { mutableStateOf(false) }
    val languageName = when (currentLocaleTag) {
        "zh-CN" -> stringResource(R.string.language_chinese)
        "ru" -> stringResource(R.string.language_russian)
        "fa" -> stringResource(R.string.language_persian)
        else -> stringResource(R.string.language_english)
    }
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp)) {
        item { PageHeader(R.string.nav_settings, R.string.settings_description) }
        item { InfoCard(R.string.appearance, if (darkTheme) stringResource(R.string.dark_mode) else stringResource(R.string.follow_system)) }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Text(stringResource(R.string.language), style = MaterialTheme.typography.labelLarge)
                    Text(languageName, style = MaterialTheme.typography.bodyLarge)
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { languageDialog = true }) { Text(stringResource(R.string.language)) }
                }
            }
        }
        item { InfoCard(R.string.security, stringResource(R.string.security_description)) }
    }
    if (languageDialog) {
        AlertDialog(
            onDismissRequest = { languageDialog = false },
            title = { Text(stringResource(R.string.language)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    listOf(
                        null to stringResource(R.string.follow_system),
                        "en" to stringResource(R.string.language_english),
                        "zh-CN" to stringResource(R.string.language_chinese),
                        "ru" to stringResource(R.string.language_russian),
                        "fa" to stringResource(R.string.language_persian)
                    ).forEach { (tag, label) ->
                        TextButton(onClick = { languageDialog = false; onLocaleSelected(tag) }, Modifier.fillMaxWidth()) { Text(label) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { languageDialog = false }) { Text(stringResource(android.R.string.cancel)) } }
        )
    }
}
@Composable private fun PageHeader(title: Int, subtitle: Int) { Column(Modifier.padding(vertical = 8.dp)) { Text(stringResource(title), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text(stringResource(subtitle), style = MaterialTheme.typography.bodyMedium) } }
@Composable private fun SectionTitle(text: Int) { Text(stringResource(text), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
@Composable private fun ProfileCard(title: Int, subtitle: Int) { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text(stringResource(title), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(stringResource(subtitle), style = MaterialTheme.typography.bodySmall) } } }
@Composable private fun InfoCard(title: Int, value: String) { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text(stringResource(title), style = MaterialTheme.typography.labelLarge); Text(value, style = MaterialTheme.typography.bodyLarge) } } }
@Composable private fun InfoRow(label: Int, value: String) { Row(Modifier.fillMaxWidth()) { Text(stringResource(label), Modifier.weight(1f)); Text(value, fontWeight = FontWeight.Medium) } }

private fun connectionPhaseLabel(phase: KernelExecutionPhase, cleanupRequired: Boolean): Int = when (phase) {
    KernelExecutionPhase.IDLE -> R.string.phase_idle
    KernelExecutionPhase.IMPORT_RECEIVED -> R.string.phase_import_received
    KernelExecutionPhase.RESOLVING -> R.string.phase_resolving
    KernelExecutionPhase.READY -> R.string.phase_ready
    KernelExecutionPhase.STARTING -> R.string.phase_starting
    KernelExecutionPhase.RUNNING -> R.string.phase_running
    KernelExecutionPhase.STOPPING -> R.string.phase_stopping
    KernelExecutionPhase.STOPPED -> R.string.phase_stopped
    KernelExecutionPhase.FAILED -> if (cleanupRequired) R.string.connection_cleanup_required else R.string.phase_failed
}

private fun runtimePhaseLabel(phase: KernelExecutionPhase): Int = when (phase) {
    KernelExecutionPhase.IDLE -> R.string.phase_idle
    KernelExecutionPhase.IMPORT_RECEIVED -> R.string.phase_import_received
    KernelExecutionPhase.RESOLVING -> R.string.phase_resolving
    KernelExecutionPhase.READY -> R.string.phase_ready
    KernelExecutionPhase.STARTING -> R.string.phase_starting
    KernelExecutionPhase.RUNNING -> R.string.phase_running
    KernelExecutionPhase.STOPPING -> R.string.phase_stopping
    KernelExecutionPhase.STOPPED -> R.string.phase_stopped
    KernelExecutionPhase.FAILED -> R.string.phase_failed
}
