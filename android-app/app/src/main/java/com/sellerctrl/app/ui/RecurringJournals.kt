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
import com.sellerctrl.app.data.DocRow
import com.sellerctrl.app.data.JeCreateLine
import com.sellerctrl.app.data.RecurJournalDetailDto
import com.sellerctrl.app.data.RecurJournalSaveReq
import kotlinx.coroutines.launch

private val RJ_FREQS = listOf("WEEKLY" to "أسبوعي", "MONTHLY" to "شهري", "QUARTERLY" to "ربع سنوي", "YEARLY" to "سنوي")
private data class RjLine(val accountId: String, val account: String, var debit: String, var credit: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecurringJournalFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var accounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var frequency by remember { mutableStateOf("MONTHLY") }
    var nextRun by remember { mutableStateOf(todayIso()) }
    val lines = remember { mutableStateListOf(RjLine("", "", "", ""), RjLine("", "", "", "")) }
    var pickFor by remember { mutableIntStateOf(-1) }
    var freqPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { accounts = try { ServiceLocator.repo.accounts() } catch (e: Exception) { emptyList() } }

    fun totalDebit() = lines.sumOf { it.debit.toDoubleOrNull() ?: 0.0 }
    fun totalCredit() = lines.sumOf { it.credit.toDoubleOrNull() ?: 0.0 }

    fun save() {
        if (name.trim().length < 2) { error = "اسم القالب مطلوب"; return }
        val payload = lines.filter { it.accountId.isNotBlank() && ((it.debit.toDoubleOrNull() ?: 0.0) > 0 || (it.credit.toDoubleOrNull() ?: 0.0) > 0) }
            .map { JeCreateLine(it.accountId, it.debit.toDoubleOrNull() ?: 0.0, it.credit.toDoubleOrNull() ?: 0.0) }
        if (payload.size < 2) { error = "أضف بندين على الأقل بقيمة وحساب"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.recurringJournalSave(RecurJournalSaveReq(null, name.trim(), description.ifBlank { null }, frequency, nextRun, payload)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("قيد متكرر جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("اسم القالب *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(description, { description = it }, label = { Text("البيان (يظهر في القيد المولّد)") }, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { freqPicker = true }, modifier = Modifier.fillMaxWidth()) { Text("التكرار: ${RJ_FREQS.firstOrNull { it.first == frequency }?.second ?: frequency}") }
            OutlinedTextField(nextRun, { nextRun = it }, label = { Text("تاريخ أول تنفيذ") }, singleLine = true, modifier = Modifier.fillMaxWidth())

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("البنود", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { lines.add(RjLine("", "", "", "")) }) { Icon(Icons.Filled.Add, null); Text(" بند") }
            }
            lines.forEachIndexed { i, l ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedButton(onClick = { pickFor = i }, modifier = Modifier.weight(1f)) {
                                Text(if (l.account.isBlank()) "اختر حساباً" else l.account, maxLines = 1)
                            }
                            if (lines.size > 2) IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Filled.Close, "حذف") }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(l.debit, { v -> lines[i] = l.copy(debit = v.filter { it.isDigit() || it == '.' }, credit = if (v.isNotBlank()) "" else l.credit) },
                                label = { Text("مدين") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                            OutlinedTextField(l.credit, { v -> lines[i] = l.copy(credit = v.filter { it.isDigit() || it == '.' }, debit = if (v.isNotBlank()) "" else l.debit) },
                                label = { Text("دائن") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
            val balanced = kotlin.math.abs(totalDebit() - totalCredit()) < 0.01
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("مدين ${money(totalDebit())}", color = MaterialTheme.colorScheme.outline)
                Text("دائن ${money(totalCredit())}", color = MaterialTheme.colorScheme.outline)
            }
            if (!balanced) Text("القيد غير متوازن", color = MaterialTheme.colorScheme.error)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy && balanced, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (pickFor >= 0) AccountPickerDialog("اختر حساباً", accounts, onDismiss = { pickFor = -1 }) { a ->
        val i = pickFor; pickFor = -1
        lines[i] = lines[i].copy(accountId = a.id, account = "${a.number} ${a.title}")
    }
    if (freqPicker) OptionPickerDialog("التكرار", RJ_FREQS, onDismiss = { freqPicker = false }) { id, _ -> frequency = id; freqPicker = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecurringJournalDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<RecurJournalDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.recurringJournalDetail(id) } catch (e: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("قيد متكرر") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.name, style = MaterialTheme.typography.titleLarge)
                        Text("${o.frequency} · التالي: ${o.nextRunDate}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        AssistChip(onClick = {}, label = { Text(if (o.isActive) "نشط" else "متوقف") })
                        if (o.description.isNotBlank()) Text(o.description, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text("البنود (${o.lines.size})", style = MaterialTheme.typography.titleMedium)
                o.lines.forEach { l ->
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(l.account, modifier = Modifier.weight(1f))
                            if (l.debit > 0) Text("مدين ${money(l.debit)}", color = MaterialTheme.colorScheme.primary)
                            if (l.credit > 0) Text("دائن ${money(l.credit)}", color = MaterialTheme.colorScheme.tertiary)
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("إجمالي مدين ${money(o.totalDebit)}", fontWeight = FontWeight.Bold)
                    Text("إجمالي دائن ${money(o.totalCredit)}", fontWeight = FontWeight.Bold)
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                Button(onClick = {
                    busy = true; message = null
                    scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/recurring-journals/$id/toggle"); message = "تم التحديث ✓"; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
                }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("تفعيل / إيقاف") }
                OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف القالب؟") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/recurring-journals/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}
