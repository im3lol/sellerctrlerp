package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.TfCreateLine
import com.sellerctrl.app.data.TfCreateReq
import com.sellerctrl.app.data.TransferDetailDto
import kotlinx.coroutines.launch

private data class TLine(val itemId: String, val name: String, var qty: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StockTransferFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var warehouses by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var fromId by remember { mutableStateOf("") }
    var fromName by remember { mutableStateOf("") }
    var toId by remember { mutableStateOf("") }
    var toName by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayIso()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<TLine>() }
    var itemPicker by remember { mutableStateOf(false) }
    var fromPicker by remember { mutableStateOf(false) }
    var toPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { warehouses = try { ServiceLocator.repo.warehouses().map { it.id to it.name } } catch (e: Exception) { emptyList() } }

    fun save() {
        if (fromId.isBlank()) { error = "اختر المستودع المصدر"; return }
        if (toId.isBlank()) { error = "اختر المستودع الوجهة"; return }
        if (fromId == toId) { error = "المصدر والوجهة متطابقان"; return }
        if (lines.isEmpty()) { error = "أضف صنفاً واحداً على الأقل"; return }
        val payload = lines.map { l ->
            val q = l.qty.toDoubleOrNull()
            if (q == null || q <= 0) return@save run { error = "تحقّق من الكميات" }
            TfCreateLine(l.itemId, fromId, toId, q)
        }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.transferCreate(TfCreateReq(date, notes.ifBlank { null }, payload)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("تحويل مخزني جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { fromPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (fromName.isBlank()) "من مستودع *" else "من: $fromName") }
            OutlinedButton(onClick = { toPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (toName.isBlank()) "إلى مستودع *" else "إلى: $toName") }
            OutlinedTextField(date, { date = it }, label = { Text("التاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("البنود (${lines.size})", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { itemPicker = true }) { Icon(Icons.Filled.Add, null); Text(" إضافة صنف") }
            }
            lines.forEachIndexed { i, l ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(l.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        OutlinedTextField(l.qty, { v -> lines[i] = l.copy(qty = v.filter { it.isDigit() || it == '.' }) }, label = { Text("كمية") }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.width(110.dp))
                        IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Filled.Close, "حذف") }
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (fromPicker) OptionPickerDialog("من مستودع", warehouses, onDismiss = { fromPicker = false }) { id, label -> fromId = id; fromName = label; fromPicker = false }
    if (toPicker) OptionPickerDialog("إلى مستودع", warehouses, onDismiss = { toPicker = false }) { id, label -> toId = id; toName = label; toPicker = false }
    if (itemPicker) ItemPickerDialog(onDismiss = { itemPicker = false }) { item ->
        itemPicker = false
        if (lines.none { it.itemId == item.id }) lines.add(TLine(item.id, item.name, "1"))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StockTransferDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<TransferDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.transferDetail(id) } catch (e: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("تحويل مخزني") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.number, style = MaterialTheme.typography.titleLarge)
                        Text(o.date, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                        if (o.notes.isNotBlank()) Text(o.notes, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text("البنود (${o.lines.size})", style = MaterialTheme.typography.titleMedium)
                o.lines.forEach { l ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(l.name, modifier = Modifier.weight(1f))
                                Text("الكمية: ${fmt(l.qty)}", color = MaterialTheme.colorScheme.outline)
                            }
                            Text("${l.from} ← ${l.to}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                if (o.status == "DRAFT") {
                    Button(onClick = {
                        busy = true; message = null
                        scope.launch { try { ServiceLocator.repo.postAction("api/v1/inventory/transfers/$id/confirm"); message = "تم التأكيد ✓"; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
                    }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "…" else "تأكيد التحويل") }
                    OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
                }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف مسودة التحويل؟") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/inventory/transfers/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}
