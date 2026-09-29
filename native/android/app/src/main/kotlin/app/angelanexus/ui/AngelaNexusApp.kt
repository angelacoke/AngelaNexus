package app.angelanexus.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.ImportExport
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.NetworkCheck
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.angelanexus.R

private data class AppDestination(val label: String, val icon: ImageVector)

private val destinations = listOf(
    AppDestination("首页", Icons.Default.Home),
    AppDestination("配置", Icons.Default.CloudDownload),
    AppDestination("代理", Icons.Default.Dns),
    AppDestination("规则", Icons.Default.List),
    AppDestination("设置", Icons.Default.Settings)
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AngelaNexusApp(
    darkTheme: Boolean,
    onImportConfig: () -> Unit,
    onStartVpn: () -> Unit
) {
    var selected by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(R.drawable.angelanexus_logo),
                            contentDescription = null,
                            modifier = Modifier.size(34.dp),
                            contentScale = ContentScale.Fit
                        )
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text("AngelaNexus", fontWeight = FontWeight.SemiBold)
                            Text("智能化全能代理系统", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                },
                actions = {
                    AssistChip(
                        onClick = {},
                        label = { Text("Core") },
                        leadingIcon = { Icon(Icons.Default.CheckCircle, null, Modifier.size(16.dp)) }
                    )
                    Spacer(Modifier.width(8.dp))
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            NavigationBar(modifier = Modifier.navigationBarsPadding()) {
                destinations.forEachIndexed { index, destination ->
                    NavigationBarItem(
                        selected = selected == index,
                        onClick = { selected = index },
                        icon = { Icon(destination.icon, contentDescription = destination.label) },
                        label = { Text(destination.label) }
                    )
                }
            }
        }
    ) { padding ->
        when (selected) {
            0 -> HomeScreen(padding, onImportConfig, onStartVpn)
            1 -> ProfilesScreen(padding, onImportConfig)
            2 -> ProxiesScreen(padding)
            3 -> RulesScreen(padding)
            else -> SettingsScreen(padding, darkTheme)
        }
    }
}

@Composable
private fun HomeScreen(padding: PaddingValues, onImportConfig: () -> Unit, onStartVpn: () -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(padding),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item { ConnectionCard(onStartVpn) }
        item { TrafficCard() }
        item {
            SectionTitle("当前环境")
            EnvironmentCard()
        }
        item {
            SectionTitle("快速操作")
            QuickActions(onImportConfig)
        }
        item {
            SectionTitle("运行状态")
            RuntimeCard()
        }
    }
}

@Composable
private fun ConnectionCard(onStartVpn: () -> Unit) {
    ElevatedCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary) {
                    Icon(Icons.Default.Shield, null, Modifier.padding(10.dp), tint = MaterialTheme.colorScheme.onPrimary)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("安全连接", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("VPN 边界已准备，内核运行时待接入", style = MaterialTheme.typography.bodyMedium)
                }
            }
            Button(onClick = onStartVpn, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Default.PlayArrow, null)
                Spacer(Modifier.width(8.dp))
                Text("启动 VPN 边界")
            }
        }
    }
}

@Composable
private fun TrafficCard() {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp)) {
        Column(Modifier.padding(18.dp)) {
            Text("实时流量", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                TrafficMetric("上传", "0 B/s", Icons.Default.ArrowUpward)
                TrafficMetric("下载", "0 B/s", Icons.Default.ArrowDownward)
                TrafficMetric("会话", "未运行", Icons.Default.NetworkCheck)
            }
        }
    }
}

@Composable
private fun TrafficMetric(label: String, value: String, icon: ImageVector) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(4.dp))
        Text(value, fontWeight = FontWeight.SemiBold)
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun EnvironmentCard() {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            InfoRow("路由策略", "智能规则")
            InfoRow("防泄露", "策略层待启用")
            InfoRow("GFW 感知", "Core 已具备")
            InfoRow("内核", "Mihomo / sing-box / Xray")
        }
    }
}

@Composable
private fun QuickActions(onImportConfig: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        FilledTonalButton(onClick = onImportConfig, modifier = Modifier.weight(1f)) {
            Icon(Icons.Default.ImportExport, null)
            Spacer(Modifier.width(6.dp))
            Text("导入配置")
        }
        OutlinedButton(onClick = {}, modifier = Modifier.weight(1f)) {
            Icon(Icons.Default.Speed, null)
            Spacer(Modifier.width(6.dp))
            Text("测速")
        }
    }
}

@Composable
private fun RuntimeCard() {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp)) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Dns, null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("统一运行时", fontWeight = FontWeight.SemiBold)
                    Text("平台 UI 不直接承担内核策略", style = MaterialTheme.typography.bodySmall)
                }
                Badge { Text("0.1") }
            }
            Spacer(Modifier.height(12.dp))
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            Text("当前为 APP UI 基线，真实内核连接将在适配器完成后显示。", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ProfilesScreen(padding: PaddingValues, onImportConfig: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader("配置", "订阅、文件和单节点统一进入自动识别流水线") }
        item { FilledTonalButton(onClick = onImportConfig, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("添加配置") } }
        item { ProfileCard("尚未导入配置", "支持订阅链接、本地文件、单节点及多节点") }
    }
}

@Composable
private fun ProxiesScreen(padding: PaddingValues) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader("代理", "统一展示不同内核的节点与策略组") }
        item { ProfileCard("暂无活动节点", "导入配置后自动识别并绑定对应内核") }
    }
}

@Composable
private fun RulesScreen(padding: PaddingValues) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader("规则", "路由、防泄露、中国网络环境与 GFW 感知") }
        item { ProfileCard("规则引擎", "Core 负责策略决策，APP 只负责可视化与操作") }
    }
}

@Composable
private fun SettingsScreen(padding: PaddingValues, darkTheme: Boolean) {
    LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageHeader("设置", "平台能力与用户偏好") }
        item { InfoCard("外观", if (darkTheme) "深色模式" else "跟随系统") }
        item { InfoCard("安全", "零意外直连、DNS/IPv6/QUIC 等策略由 Core 统一管理") }
        item { InfoCard("内核", "Mihomo / sing-box / Xray 自动绑定") }
    }
}

@Composable
private fun PageHeader(title: String, subtitle: String) {
    Column(Modifier.padding(vertical = 8.dp)) {
        Text(title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun ProfileCard(title: String, subtitle: String) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(22.dp)) {
        Row(Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                Icon(Icons.Default.CloudDownload, null, Modifier.padding(10.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = {}) { Icon(Icons.Default.MoreHoriz, null) }
        }
    }
}

@Composable
private fun InfoCard(title: String, value: String) {
    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp)) {
        Column(Modifier.padding(18.dp)) {
            Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(6.dp))
            Text(value, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}
