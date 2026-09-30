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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.angelanexus.AndroidTransparentMode
import app.angelanexus.R

private data class AppDestination(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val destinations = listOf(
    AppDestination("首页", Icons.Default.Home), AppDestination("配置", Icons.Default.CloudDownload),
    AppDestination("代理", Icons.Default.Dns), AppDestination("规则", Icons.Default.List), AppDestination("设置", Icons.Default.Settings)
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AngelaNexusApp(
    darkTheme: Boolean,
    transparentMode: AndroidTransparentMode,
    rootAvailable: Boolean,
    onTransparentModeChange: (AndroidTransparentMode) -> Unit,
    onImportConfig: () -> Unit,
    onStartVpn: () -> Unit
) {
    var selected by remember { mutableIntStateOf(0) }
    Scaffold(
        topBar = { TopAppBar(title = { Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.angelanexus_logo), null, Modifier.size(34.dp))
            Spacer(Modifier.width(10.dp)); Column { Text("AngelaNexus", fontWeight = FontWeight.SemiBold); Text("智能化全能代理系统", style = MaterialTheme.typography.labelSmall) }
        }}, actions = { AssistChip(onClick = {}, label = { Text("Core") }, leadingIcon = { Icon(Icons.Default.CheckCircle, null, Modifier.size(16.dp)) }) }) },
        bottomBar = { NavigationBar { destinations.forEachIndexed { index, destination ->
            NavigationBarItem(selected == index, { selected = index }, { Icon(destination.icon, destination.label) }, label = { Text(destination.label) })
        } } }
    ) { padding ->
        when (selected) {
            0 -> HomeScreen(padding, transparentMode, rootAvailable, onTransparentModeChange, onImportConfig, onStartVpn)
            1 -> ProfilesScreen(padding, onImportConfig)
            2 -> ProxiesScreen(padding)
            3 -> RulesScreen(padding)
            else -> SettingsScreen(padding, darkTheme)
        }
    }
}

@Composable
private fun HomeScreen(padding: PaddingValues, mode: AndroidTransparentMode, rootAvailable: Boolean, onMode: (AndroidTransparentMode) -> Unit, onImport: () -> Unit, onStart: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { ConnectionCard(mode, rootAvailable, onMode, onStart) }
        item { TrafficCard() }
        item { SectionTitle("当前环境"); EnvironmentCard() }
        item { SectionTitle("快速操作"); QuickActions(onImport) }
        item { SectionTitle("运行状态"); RuntimeCard() }
    }
}

@Composable
private fun ConnectionCard(mode: AndroidTransparentMode, rootAvailable: Boolean, onMode: (AndroidTransparentMode) -> Unit, onStart: () -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("透明网络接入", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("应用无需代理配置；系统接入层统一交给平台适配器。", style = MaterialTheme.typography.bodyMedium)
            listOf(AndroidTransparentMode.AUTO, AndroidTransparentMode.SYSTEM, AndroidTransparentMode.ROOT).forEach { option ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    RadioButton(selected = mode == option, onClick = { if (option != AndroidTransparentMode.ROOT || rootAvailable) onMode(option) }, enabled = option != AndroidTransparentMode.ROOT || rootAvailable)
                    Column { Text(when(option) { AndroidTransparentMode.AUTO -> "自动"; AndroidTransparentMode.SYSTEM -> "系统透明模式"; AndroidTransparentMode.ROOT -> "Root 增强透明模式" }); if (option == AndroidTransparentMode.ROOT && !rootAvailable) Text("未检测到可用 Root 能力", style = MaterialTheme.typography.labelSmall) }
                }
            }
            Button(onClick = onStart, Modifier.fillMaxWidth()) { Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(8.dp)); Text("启动透明网络接入") }
        }
    }
}

@Composable private fun TrafficCard() { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text("实时流量", fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(12.dp)); Text("上传  0 B/s    下载  0 B/s    会话  未运行") } } }
@Composable private fun EnvironmentCard() { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { InfoRow("路由策略", "智能规则"); InfoRow("防泄露", "策略层待启用"); InfoRow("GFW 感知", "Core 已具备"); InfoRow("内核", "Mihomo / sing-box / Xray") } } }
@Composable private fun QuickActions(onImport: () -> Unit) { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { FilledTonalButton(onClick = onImport, Modifier.weight(1f)) { Icon(Icons.Default.ImportExport, null); Spacer(Modifier.width(6.dp)); Text("导入配置") }; OutlinedButton(onClick = {}, Modifier.weight(1f)) { Icon(Icons.Default.Speed, null); Spacer(Modifier.width(6.dp)); Text("测速") } } }
@Composable private fun RuntimeCard() { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text("统一运行时", fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(8.dp)); Text("平台 UI 不直接承担内核策略", style = MaterialTheme.typography.bodySmall) } } }
@Composable private fun ProfilesScreen(padding: PaddingValues, onImport: () -> Unit) { LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { item { PageHeader("配置", "订阅、文件和单节点统一进入自动识别流水线") }; item { FilledTonalButton(onClick = onImport, Modifier.fillMaxWidth()) { Text("添加配置") } }; item { ProfileCard("尚未导入配置", "支持订阅链接、本地文件、单节点及多节点") } } }
@Composable private fun ProxiesScreen(padding: PaddingValues) { LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp)) { item { PageHeader("代理", "统一展示不同内核的节点与策略组") } } }
@Composable private fun RulesScreen(padding: PaddingValues) { LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp)) { item { PageHeader("规则", "路由、防泄露、中国网络环境与 GFW 感知") } } }
@Composable private fun SettingsScreen(padding: PaddingValues, darkTheme: Boolean) { LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp)) { item { PageHeader("设置", "平台能力与用户偏好") }; item { InfoCard("外观", if (darkTheme) "深色模式" else "跟随系统") }; item { InfoCard("安全", "零意外直连、DNS/IPv6/QUIC 等策略由 Core 统一管理") } } }
@Composable private fun PageHeader(title: String, subtitle: String) { Column(Modifier.padding(vertical = 8.dp)) { Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text(subtitle, style = MaterialTheme.typography.bodyMedium) } }
@Composable private fun SectionTitle(text: String) { Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
@Composable private fun ProfileCard(title: String, subtitle: String) { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(subtitle, style = MaterialTheme.typography.bodySmall) } } }
@Composable private fun InfoCard(title: String, value: String) { Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp)) { Text(title, style = MaterialTheme.typography.labelLarge); Text(value, style = MaterialTheme.typography.bodyLarge) } } }
@Composable private fun InfoRow(label: String, value: String) { Row(Modifier.fillMaxWidth()) { Text(label, Modifier.weight(1f)); Text(value, fontWeight = FontWeight.Medium) } }
