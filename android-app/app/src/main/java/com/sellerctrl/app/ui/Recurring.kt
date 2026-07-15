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
import com.sellerctrl.app.data.OrderDetailDto
import com.sellerctrl.app.data.RecurLine
import com.sellerctrl.app.data.RecurSaveReq
import kotlinx.coroutines.launch

private val FREQS = listOf("WEEKLY" to "أسبوعي", "MONTHLY" to "شهري", "QUARTERLY" to "ربع سنوي", "YEARLY" to "سنوي")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecurringFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var customers by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var custId by remember { mutableStateOf("") }
    var custName by remember { mutableStateOf("") }
    var frequency by remember { mutableStateOf("MONTHLY") }
    var nextRun by remember { mutableStateOf(todayIso()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<SLine>() }
    var custPicker by remember { mutableStateOf(false) }
    var freqPicker by remember { mutableStateOf(false) }
    var itemPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        customers = try { ServiceLocator.repo.docList("api/v1/parties/customers").map { it.id to it.title } } catch (e: Exception) { emptyList() }
    }

    fun total(): Double = lines.sumOf { (it.qty.toDoubleOrNull() ?: 0.0) * (it.price.toDoubleOrNull() ?: 0.0) }

    fun save() {
        if (custId.isBlank()) { error = "اختر العميل"; return }
        if (lines.isEmpty()) { error = "أضف صنفاً واحداً على الأقل"; return }
        val payload = lines.map { l ->
            val q = l.qty.toDoubleOrNull(); val p = l.price.toDoubleOrNull()
            if (q == null || q <= 0 || p == null || p < 0) return@save run { error = "تحقّق من الكميات والأسعار" }
            RecurLine(l.itemId, q, p)
        }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.recurringCreate(RecurSaveReq(null, custId, frequency, nextRun, notes.ifBlank { null }, payload)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("فاتورة دورية جديدة") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { custPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (custName.isBlank()) "اختر العميل *" else "العميل: $custName") }
            OutlinedButton(onClick = { freqPicker = true }, modifier = Modifier.fillMaxWidth()) { Text("التكرار: ${FREQS.firstOrNull { it.first == frequency }?.second ?: frequency}") }
            OutlinedTextField(nextRun, { nextRun = it }, label = { Text("تاريخ أول تنفيذ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("البنود (${lines.size})", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { itemPicker = true }) { Icon(Icons.Filled.Add, null); Text(" إضافة صنف") }
            }
            lines.forEachIndexed { i, l ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(l.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Filled.Close, "حذف") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(l.qty, { v -> lines[i] = l.copy(qty = v.filter { it.isDigit() || it == '.' }) }, label = { Text("كمية") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                            OutlinedTextField(l.price, { v -> lines[i] = l.copy(price = v.filter { it.isDigit() || it == '.' }) }, label = { Text("سعر الوحدة") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
            if (lines.isNotEmpty()) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("الإجمالي", fontWeight = FontWeight.Bold)
                Text(money(total()), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (custPicker) OptionPickerDialog("اختر العميل", customers, onDismiss = { custPicker = false }) { id, label -> custId = id; custName = label; custPicker = false }
    if (freqPicker) OptionPickerDialog("التكرار", FREQS, onDismiss = { freqPicker = false }) { id, _ -> frequency = id; freqPicker = false }
    if (itemPicker) ItemPickerDialog(onDismiss = { itemPicker = false }) { item ->
        itemPicker = false
        if (lines.none { it.itemId == item.id }) lines.add(SLine(item.id, item.name, "1", fmt(item.sellPrice)))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecurringDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<OrderDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.orderDetail("api/v1/sales/recurring/$id") } catch (e: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("فاتورة دورية") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.party, style = MaterialTheme.typography.titleLarge)
                        Text("${o.number} · التالي: ${o.date}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
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
                Button(onClick = {
                    busy = true; message = null
                    scope.launch { try { ServiceLocator.repo.postAction("api/v1/sales/recurring/$id/toggle"); message = "تم التحديث ✓"; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
                }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("تفعيل / إيقاف") }
                OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف الفاتورة الدورية؟") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/sales/recurring/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}
