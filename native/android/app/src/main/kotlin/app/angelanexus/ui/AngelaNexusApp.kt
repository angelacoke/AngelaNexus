package app.angelanexus.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
fun AngelaNexusApp(
    darkTheme: Boolean,
    transparentMode: AndroidTransparentMode,
    rootAvailable: Boolean,
    importResult: CoreRuntimeImportResult?,
    executionState: KernelExecutionState,
    uiStatus: AndroidUiStatus,
    onTransparentModeChange: (AndroidTransparentMode) -> Unit,
    onImportConfig: () -> Unit,
    onStartVpn: () -> Unit,
    onStopVpn: () -> Unit,
    currentLocaleTag: String,
    onLocaleSelected: (String?) -> Unit
) {
    var selected by remember { mutableIntStateOf(0) }
    Scaffold(
        topBar = { TopAppBar(title = { Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.angelanexus_logo), null, Modifier.size(34.dp))
            Spacer(Modifier.width(10.dp)); Column { Text(stringResource(R.string.app_name), fontWeight = FontWeight.SemiBold); Text(stringResource(R.string.app_subtitle), style = MaterialTheme.typography.labelSmall) }
        }}) },
        bottomBar = { NavigationBar { destinations.forEachIndexed { index, destination ->
            NavigationBarItem(selected == index, { selected = index }, { Icon(destination.icon, stringResource(destination.label)) }, label = { Text(stringResource(destination.label)) })
        } } }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            RuntimeStatusBanner(uiStatus, executionState)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (selected) {
                    0 -> HomeScreen(PaddingValues(0.dp), transparentMode, rootAvailable, importResult, executionState, onTransparentModeChange, onImportConfig, onStartVpn, onStopVpn)
                    1 -> ProfilesScreen(PaddingValues(0.dp), onImportConfig, importResult)
                    2 -> ProxiesScreen(PaddingValues(0.dp), importResult, onImportConfig)
                    3 -> RulesScreen(PaddingValues(0.dp), importResult)
                    else -> SettingsScreen(PaddingValues(0.dp), darkTheme, currentLocaleTag, onLocaleSelected)
                }
            }
        }
    }
}

@Composable
private fun RuntimeStatusBanner(status: AndroidUiStatus, executionState: KernelExecutionState) {
    val operationMessage = when (status) {
        AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE -> R.string.status_core_unavailable to true
        AndroidUiStatus.CONFIG_NOT_STARTABLE -> R.string.status_config_not_startable to true
        AndroidUiStatus.VPN_RUNTIME_NOT_READY -> R.string.status_vpn_not_ready to true
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
            AndroidUiStatus.CORE_RUNTIME_UNAVAILABLE -> R.string.status_core_unavailable to true
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
    onMode: (AndroidTransparentMode) -> Unit,
    onImport: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ConnectionCard(mode, rootAvailable, importResult, executionState, onMode, onStart, onStop) }
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
    onMode: (AndroidTransparentMode) -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
) {
    val phase = executionState.phase
    val activeOrCleaning = phase == KernelExecutionPhase.STARTING ||
        phase == KernelExecutionPhase.RUNNING ||
        phase == KernelExecutionPhase.STOPPING ||
        (phase == KernelExecutionPhase.FAILED && executionState.cleanupRequired)
    val canStart = canStartAndroidRuntime(executionState, importResult)
    ElevatedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.transparent_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.transparent_description), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(connectionPhaseLabel(phase, executionState.cleanupRequired)), style = MaterialTheme.typography.titleMedium)
            listOf(AndroidTransparentMode.AUTO, AndroidTransparentMode.SYSTEM, AndroidTransparentMode.ROOT).forEach { option ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    RadioButton(selected = mode == option, onClick = { if (!activeOrCleaning && (option != AndroidTransparentMode.ROOT || rootAvailable)) onMode(option) }, enabled = !activeOrCleaning && (option != AndroidTransparentMode.ROOT || rootAvailable))
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
            if (!canStart && !activeOrCleaning) {
                Text(stringResource(R.string.start_requires_config), style = MaterialTheme.typography.bodySmall)
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
private fun ProfilesScreen(padding: PaddingValues, onImport: () -> Unit, result: CoreRuntimeImportResult?) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader(R.string.nav_profiles, R.string.profiles_description) }
        item { FilledTonalButton(onClick = onImport, Modifier.fillMaxWidth()) { Text(stringResource(R.string.add_config)) } }
        item {
            if (result == null) {
                ProfileCard(R.string.no_profiles, R.string.profile_support)
            } else {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.import_result_ready), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.import_result_kernel, result.kernel ?: stringResource(R.string.unknown_value)))
                        Text(stringResource(R.string.import_result_nodes, result.nodeCount))
                        result.source?.let { Text(stringResource(R.string.import_result_source, it)) }
                        Text(stringResource(R.string.profile_support), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun ProxiesScreen(padding: PaddingValues, result: CoreRuntimeImportResult?, onImport: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader(R.string.nav_proxies, R.string.proxies_description) }
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (result == null) {
                        Text(stringResource(R.string.no_profiles), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.profile_support), style = MaterialTheme.typography.bodySmall)
                        FilledTonalButton(onClick = onImport) { Text(stringResource(R.string.add_config)) }
                    } else {
                        Text(stringResource(R.string.import_result_ready), fontWeight = FontWeight.SemiBold)
                        Text(stringResource(R.string.import_result_nodes, result.nodeCount))
                        Text(stringResource(R.string.import_result_kernel, result.kernel ?: stringResource(R.string.unknown_value)))
                        Text(stringResource(R.string.status_not_reported), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
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
