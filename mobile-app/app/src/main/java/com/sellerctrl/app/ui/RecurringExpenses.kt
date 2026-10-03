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
import com.sellerctrl.app.data.RecurExpDetailDto
import com.sellerctrl.app.data.RecurExpSaveReq
import kotlinx.coroutines.launch

private val EXP_FREQS = listOf("WEEKLY" to "أسبوعي", "MONTHLY" to "شهري", "QUARTERLY" to "ربع سنوي", "YEARLY" to "سنوي")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecurringExpenseFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var expAccounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var cashAccounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var expId by remember { mutableStateOf("") }
    var expName by remember { mutableStateOf("") }
    var cashId by remember { mutableStateOf("") }
    var cashName by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var frequency by remember { mutableStateOf("MONTHLY") }
    var nextRun by remember { mutableStateOf(todayIso()) }
    var payee by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var expPicker by remember { mutableStateOf(false) }
    var cashPicker by remember { mutableStateOf(false) }
    var freqPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        expAccounts = try { ServiceLocator.repo.accounts("EXPENSE") } catch (e: Exception) { emptyList() }
        cashAccounts = try { ServiceLocator.repo.cashAccounts() } catch (e: Exception) { emptyList() }
    }

    fun save() {
        if (expId.isBlank()) { error = "اختر بند المصروف"; return }
        if (cashId.isBlank()) { error = "اختر حساب النقدية/البنك"; return }
        val amt = amount.toDoubleOrNull()
        if (amt == null || amt <= 0) { error = "مبلغ غير صالح"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.recurringExpenseSave(RecurExpSaveReq(null, expId, cashId, amt, frequency, nextRun, "CASH", payee.ifBlank { null }, notes.ifBlank { null })); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("مصروف دوري جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { expPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (expName.isBlank()) "بند المصروف *" else expName) }
            OutlinedButton(onClick = { cashPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (cashName.isBlank()) "من حساب (نقدية/بنك) *" else cashName) }
            OutlinedTextField(amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("المبلغ") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { freqPicker = true }, modifier = Modifier.fillMaxWidth()) { Text("التكرار: ${EXP_FREQS.firstOrNull { it.first == frequency }?.second ?: frequency}") }
            OutlinedTextField(nextRun, { nextRun = it }, label = { Text("تاريخ أول تنفيذ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(payee, { payee = it }, label = { Text("المستفيد (اختياري)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (expPicker) AccountPickerDialog("بند المصروف", expAccounts, onDismiss = { expPicker = false }) { a -> expId = a.id; expName = "${a.number} ${a.title}"; expPicker = false }
    if (cashPicker) AccountPickerDialog("حساب النقدية/البنك", cashAccounts, onDismiss = { cashPicker = false }) { a -> cashId = a.id; cashName = "${a.number} ${a.title}"; cashPicker = false }
    if (freqPicker) OptionPickerDialog("التكرار", EXP_FREQS, onDismiss = { freqPicker = false }) { id, _ -> frequency = id; freqPicker = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecurringExpenseDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<RecurExpDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.recurringExpenseDetail(id) } catch (e: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("مصروف دوري") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.account, style = MaterialTheme.typography.titleLarge)
                        Text("${o.frequency} · التالي: ${o.nextRunDate}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            AssistChip(onClick = {}, label = { Text(if (o.isActive) "نشط" else "متوقف") })
                            Text(money(o.amount), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        }
                        Text("من: ${o.cashAccount}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        if (o.payee.isNotBlank()) Text("المستفيد: ${o.payee}", style = MaterialTheme.typography.bodySmall)
                        if (o.notes.isNotBlank()) Text(o.notes, style = MaterialTheme.typography.bodySmall)
                    }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                Button(onClick = {
                    busy = true; message = null
                    scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/recurring-expenses/$id/toggle"); message = "تم التحديث ✓"; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
                }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("تفعيل / إيقاف") }
                OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف المصروف الدوري؟") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/recurring-expenses/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}
