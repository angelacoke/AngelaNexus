package app.angelanexus.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

data class ProfileFeatureGroup(
    val id: String,
    val name: String,
    val enabled: Boolean = true,
)

data class ProfileFeatureChain(
    val id: String,
    val name: String,
)

@Composable
fun ProfileFeatureSwitches(
    groups: List<ProfileFeatureGroup>,
    chains: List<ProfileFeatureChain>,
    initialChainEnabled: Boolean = false,
    onGroupEnabledChange: (groupId: String, enabled: Boolean) -> Unit,
    onChainEnabledChange: (enabled: Boolean) -> Unit,
    onChainSelected: (chainId: String?) -> Unit,
) {
    var chainEnabled by remember { mutableStateOf(initialChainEnabled) }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("当前配置自定义", style = MaterialTheme.typography.titleLarge)
            Text(
                "仅修改当前配置的运行策略，不改变原始订阅内容。关闭后，该策略组不会进入当前运行计划。",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Row(Modifier.weight(1f)) {
                            Icon(Icons.Default.Tune, null)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text("策略组")
                                Text("逐项开启或关闭", style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    groups.forEach { group ->
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(group.name, Modifier.weight(1f))
                            Switch(
                                checked = group.enabled,
                                onCheckedChange = { onGroupEnabledChange(group.id, it) },
                            )
                        }
                    }
                }
            }
        }

        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Row(Modifier.weight(1f)) {
                            Icon(Icons.Default.Link, null)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text("链式代理")
                                Text(
                                    "开启后按当前配置选择的链路执行；关闭则不建立链路。",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                        Switch(
                            checked = chainEnabled,
                            onCheckedChange = {
                                chainEnabled = it
                                onChainEnabledChange(it)
                            },
                        )
                    }

                    if (chainEnabled) {
                        chains.forEach { chain ->
                            OutlinedButton(
                                onClick = { onChainSelected(chain.id) },
                                Modifier.fillMaxWidth(),
                            ) {
                                Text(chain.name)
                            }
                        }
                        if (chains.isEmpty()) {
                            Text(
                                "当前配置没有可用链路。",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
        }
    }
}
