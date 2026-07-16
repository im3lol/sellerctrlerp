package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.CountLine
import com.sellerctrl.app.data.ItemDto
import com.sellerctrl.app.data.WarehouseDto
import kotlinx.coroutines.launch

private data class CountRow(val item: ItemDto, val qty: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdjustmentScreen(nav: NavController) {
    val repo = ServiceLocator.repo
    val scope = rememberCoroutineScope()
    var warehouses by remember { mutableStateOf<List<WarehouseDto>>(emptyList()) }
    var selected by remember { mutableStateOf<WarehouseDto?>(null) }
    var reason by remember { mutableStateOf("") }
    val rows = remember { mutableStateListOf<CountRow>() }
    var scanning by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            warehouses = repo.warehouses()
            selected = warehouses.firstOrNull()
        } catch (_: Exception) {
        }
    }

    if (scanning) {
        Box(Modifier.fillMaxSize()) {
            CameraPreview(onCode = { code ->
                scope.launch {
                    try {
                        val it = repo.scan(code)
                        if (rows.none { r -> r.item.id == it.id }) rows.add(CountRow(it, ""))
                    } catch (_: Exception) {
                    }
                    scanning = false
                }
            })
            Button(onClick = { scanning = false }, modifier = Modifier.align(Alignment.BottomCenter).padding(24.dp)) {
                Text("إغلاق الكاميرا")
            }
        }
        return
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("جرد المخزون") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
        )
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(16.dp)) {
            Text("المستودع", style = MaterialTheme.typography.labelLarge)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(warehouses) { w ->
                    FilterChip(selected = selected?.id == w.id, onClick = { selected = w }, label = { Text(w.name) })
                }
            }
            OutlinedTextField(
                value = reason, onValueChange = { reason = it },
                label = { Text("السبب (اختياري)") }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Button(onClick = { scanning = true }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Icon(Icons.Filled.QrCodeScanner, null, modifier = Modifier.padding(end = 8.dp))
                Text("مسح صنف")
            }
            message?.let { Text(it, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp)) }

            LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
                items(rows, key = { it.item.id }) { row ->
                    AppCard(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(row.item.name, style = MaterialTheme.typography.titleSmall)
                                Text("رصيد النظام: ${fmt(row.item.stock)}", style = MaterialTheme.typography.bodySmall)
                            }
                            OutlinedTextField(
                                value = row.qty,
                                onValueChange = { v ->
                                    val i = rows.indexOfFirst { it.item.id == row.item.id }
                                    if (i >= 0) rows[i] = rows[i].copy(qty = v)
                                },
                                label = { Text("المعدود") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.width(120.dp),
                            )
                            IconButton(onClick = { rows.removeAll { it.item.id == row.item.id } }) {
                                Icon(Icons.Filled.Delete, null)
                            }
                        }
                    }
                }
            }

            Button(
                onClick = {
                    val wh = selected ?: return@Button
                    val lines = rows.mapNotNull { r -> r.qty.toDoubleOrNull()?.let { CountLine(r.item.id, it) } }
                    if (lines.isEmpty()) { message = "أدخل الكميات المعدودة"; return@Button }
                    busy = true; message = null
                    scope.launch {
                        try {
                            repo.submitCount(wh.id, reason, lines)
                            rows.clear(); reason = ""; message = "تم حفظ الجرد ✓"
                        } catch (e: Exception) {
                            message = e.message ?: "خطأ"
                        } finally {
                            busy = false
                        }
                    }
                },
                enabled = !busy && rows.isNotEmpty() && selected != null,
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (busy) "جارٍ الحفظ…" else "حفظ الجرد") }
        }
    }
}
