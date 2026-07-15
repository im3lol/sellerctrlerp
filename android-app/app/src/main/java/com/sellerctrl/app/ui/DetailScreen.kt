package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.OrderDetailDto
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(nav: NavController, title: String, detailPath: String, confirmPath: String?, fulfillPath: String? = null, deletePath: String? = null) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<OrderDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.orderDetail(detailPath) } catch (e: Exception) { null } }

    fun runAction(path: String, okMsg: String) {
        busy = true; message = null
        scope.launch {
            try { ServiceLocator.repo.postAction(path); message = okMsg; reload++ }
            catch (e: Exception) { message = e.message ?: "خطأ" }
            finally { busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
        )
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(o.party, style = MaterialTheme.typography.titleLarge)
                            Text("${o.number} · ${o.date}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                                Text(money(o.total), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            }
                        }
                    }

                    Text("البنود (${o.lines.size})", style = MaterialTheme.typography.titleMedium)
                    o.lines.forEach { l ->
                        Card(Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(l.name, style = MaterialTheme.typography.titleSmall)
                                    Text("${fmt(l.qty)} × ${money(l.unitPrice)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                }
                                Text(money(l.total), style = MaterialTheme.typography.titleSmall)
                            }
                        }
                    }

                    message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }

                    if (o.status == "DRAFT" && confirmPath != null) {
                        Button(
                            onClick = { runAction(confirmPath, "تم التأكيد ✓") },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (busy) "جارٍ التأكيد…" else "تأكيد الأمر") }
                    }

                    if (o.status == "CONFIRMED" && fulfillPath != null) {
                        Button(
                            onClick = { runAction(fulfillPath, "تم التسليم والفوترة ✓") },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (busy) "جارٍ التنفيذ…" else "تسليم وفوترة") }
                    }

                    if (o.status == "DRAFT" && deletePath != null) {
                        androidx.compose.material3.OutlinedButton(
                            onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                            colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) { Text("حذف") }
                    }
                }
            }
        }
    }

    if (confirmDelete && deletePath != null) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("حذف") },
            text = { Text("متأكد من حذف هذا المستند؟") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    confirmDelete = false; busy = true; message = null
                    scope.launch {
                        try { ServiceLocator.repo.postAction(deletePath); nav.popBackStack() }
                        catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false }
                    }
                }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { androidx.compose.material3.OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
        )
    }
}
