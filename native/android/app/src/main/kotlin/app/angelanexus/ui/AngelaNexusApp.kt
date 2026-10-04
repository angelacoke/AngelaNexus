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
import app.angelanexus.CoreRuntimeImportResult
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
    onTransparentModeChange: (AndroidTransparentMode) -> Unit,
    onImportConfig: () -> Unit,
    onStartVpn: () -> Unit,
    currentLocaleTag: String,
    onLocaleSelected: (String?) -> Unit
) {
    var selected by remember { mutableIntStateOf(0) }
    Scaffold(
        topBar = { TopAppBar(title = { Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.angelanexus_logo), null, Modifier.size(34.dp))
            Spacer(Modifier.width(10.dp)); Column { Text(stringResource(R.string.app_name), fontWeight = FontWeight.SemiBold); Text(stringResource(R.string.app_subtitle), style = MaterialTheme.typography.labelSmall) }
        }}, actions = { AssistChip(onClick = {}, label = { Text(stringResource(R.string.core_label)) }, leadingIcon = { Icon(Icons.Default.CheckCircle, null, Modifier.size(16.dp)) }) }) },
        bottomBar = { NavigationBar { destinations.forEachIndexed { index, destination ->
            NavigationBarItem(selected == index, { selected = index }, { Icon(destination.icon, stringResource(destination.label)) }, label = { Text(stringResource(destination.label)) })
        } } }
    ) { padding ->
        when (selected) {
            0 -> HomeScreen(padding, transparentMode, rootAvailable, importResult, onTransparentModeChange, onImportConfig, onStartVpn)
            1 -> ProfilesScreen(padding, onImportConfig, importResult)
            2 -> ProxiesScreen(padding)
            3 -> RulesScreen(padding)
            else -> SettingsScreen(padding, darkTheme, currentLocaleTag, onLocaleSelected)
        }
    }
}

@Composable
private fun HomeScreen(
    padding: PaddingValues,
    mode: AndroidTransparentMode,
    rootAvailable: Boolean,
    importResult: CoreRuntimeImportResult?,
    onMode: (AndroidTransparentMode) -> Unit,
    onImport: () -> Unit,
    onStart: () -> Unit
) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ConnectionCard(mode, rootAvailable, onMode, onStart) }
        item { TrafficCard() }
        item { SectionTitle(R.string.section_environment); EnvironmentCard() }
        item { SectionTitle(R.string.section_quick_actions); QuickActions(onImport) }
        item { SectionTitle(R.string.section_runtime); RuntimeCard(importResult) }
    }
}

@Composable
private fun ConnectionCard(mode: AndroidTransparentMode, rootAvailable: Boolean, onMode: (AndroidTransparentMode) -> Unit, onStart: () -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.transparent_title), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.transparent_description), style = MaterialTheme.typography.bodyMedium)
            listOf(AndroidTransparentMode.AUTO, AndroidTransparentMode.SYSTEM, AndroidTransparentMode.ROOT).forEach { option ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    RadioButton(selected = mode == option, onClick = { if (option != AndroidTransparentMode.ROOT || rootAvailable) onMode(option) }, enabled = option != AndroidTransparentMode.ROOT || rootAvailable)
                    Column { Text(when(option) { AndroidTransparentMode.AUTO -> stringResource(R.string.mode_auto); AndroidTransparentMode.SYSTEM -> stringResource(R.string.mode_system); AndroidTransparentMode.ROOT -> stringResource(R.string.mode_root) }); if (option == AndroidTransparentMode.ROOT && !rootAvailable) Text(stringResource(R.string.root_unavailable), style = MaterialTheme.typography.labelSmall) }
                }
            }
            Button(onClick = onStart, Modifier.fillMaxWidth()) { Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.start_transparent)) }
        }
    }
}

@Composable private fun TrafficCard() { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text(stringResource(R.string.traffic_title), fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(12.dp)); Text(stringResource(R.string.traffic_idle)) } } }
@Composable private fun EnvironmentCard() { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { InfoRow(R.string.route_policy, R.string.route_smart); InfoRow(R.string.leak_prevention, R.string.pending_policy); InfoRow(R.string.gfw_awareness, R.string.core_available); InfoRow(R.string.kernels, R.string.kernel_list) } } }
@Composable private fun QuickActions(onImport: () -> Unit) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { FilledTonalButton(onClick = onImport, Modifier.weight(1f)) { Icon(Icons.Default.ImportExport, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.import_config)) }; OutlinedButton(onClick = {}, Modifier.weight(1f)) { Icon(Icons.Default.Speed, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.speed_test)) } } }
@Composable private fun RuntimeCard(result: CoreRuntimeImportResult?) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.runtime_title), fontWeight = FontWeight.SemiBold)
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
@Composable private fun ProfilesScreen(padding: PaddingValues, onImport: () -> Unit, result: CoreRuntimeImportResult?) { LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { item { PageHeader(R.string.nav_profiles, R.string.profiles_description) }; item { FilledTonalButton(onClick = onImport, Modifier.fillMaxWidth()) { Text(stringResource(R.string.add_config)) } }; item { if (result == null) ProfileCard(R.string.no_profiles, R.string.profile_support) else ProfileCard(R.string.import_result_ready, R.string.profile_support) } } }
@Composable private fun ProxiesScreen(padding: PaddingValues) { LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp)) { item { PageHeader(R.string.nav_proxies, R.string.proxies_description) } } }
@Composable private fun RulesScreen(padding: PaddingValues) { LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp)) { item { PageHeader(R.string.nav_rules, R.string.rules_description) } } }
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
@Composable private fun InfoRow(label: Int, value: Int) { Row(Modifier.fillMaxWidth()) { Text(stringResource(label), Modifier.weight(1f)); Text(stringResource(value), fontWeight = FontWeight.Medium) } }
