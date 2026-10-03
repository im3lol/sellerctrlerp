package com.sellerctrl.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
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
import com.sellerctrl.app.data.BankSaveReq
import com.sellerctrl.app.data.DocRow
import com.sellerctrl.app.data.ExpenseCreateReq
import com.sellerctrl.app.data.ExpenseDetailDto
import com.sellerctrl.app.data.JeCreateLine
import com.sellerctrl.app.data.JeCreateReq
import com.sellerctrl.app.data.JournalDetailDto
import kotlinx.coroutines.launch

/** Searchable picker over a preloaded account list (code + name). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountPickerDialog(title: String, accounts: List<DocRow>, onDismiss: () -> Unit, onPick: (DocRow) -> Unit) {
    var q by remember { mutableStateOf("") }
    val filtered = if (q.isBlank()) accounts else accounts.filter { it.title.contains(q, true) || it.number.contains(q, true) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(q, { q = it }, label = { Text("بحث") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 340.dp).padding(top = 8.dp)) {
                    items(filtered) { a ->
                        Column(Modifier.fillMaxWidth().clickable { onPick(a) }.padding(vertical = 10.dp)) {
                            Text(a.title, style = MaterialTheme.typography.bodyMedium)
                            Text("${a.number} · ${a.status ?: ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } },
    )
}

// ---- Journal (القيود اليومية) --------------------------------------------

private data class JeLine(val accountId: String, val account: String, var debit: String, var credit: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JournalFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var accounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var date by remember { mutableStateOf(todayIso()) }
    var description by remember { mutableStateOf("") }
    var postNow by remember { mutableStateOf(false) }
    val lines = remember { mutableStateListOf(JeLine("", "", "", ""), JeLine("", "", "", "")) }
    var pickFor by remember { mutableStateOf(-1) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { accounts = try { ServiceLocator.repo.accounts() } catch (e: Exception) { emptyList() }
    }

    fun totalDebit() = lines.sumOf { it.debit.toDoubleOrNull() ?: 0.0 }
    fun totalCredit() = lines.sumOf { it.credit.toDoubleOrNull() ?: 0.0 }

    fun save() {
        if (description.isBlank()) { error = "البيان مطلوب"; return }
        val payload = lines.filter { it.accountId.isNotBlank() && ((it.debit.toDoubleOrNull() ?: 0.0) > 0 || (it.credit.toDoubleOrNull() ?: 0.0) > 0) }
            .map { JeCreateLine(it.accountId, it.debit.toDoubleOrNull() ?: 0.0, it.credit.toDoubleOrNull() ?: 0.0) }
        if (payload.size < 2) { error = "أضف بندين على الأقل بقيمة وحساب"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.journalCreate(JeCreateReq(date, description, null, if (postNow) "post" else "draft", payload)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("قيد يومية جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(date, { date = it }, label = { Text("التاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(description, { description = it }, label = { Text("البيان") }, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("البنود", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { lines.add(JeLine("", "", "", "")) }) { Icon(Icons.Filled.Add, null); Text(" بند") }
            }
            lines.forEachIndexed { i, l ->
                AppCard(Modifier.fillMaxWidth()) {
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(postNow, { postNow = it }); Text("ترحيل مباشر")
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy && balanced, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (pickFor >= 0) AccountPickerDialog("اختر حساباً", accounts, onDismiss = { pickFor = -1 }) { a ->
        val i = pickFor; pickFor = -1
        lines[i] = lines[i].copy(accountId = a.id, account = "${a.number} ${a.title}")
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JournalDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<JournalDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.journalDetail(id) } catch (e: Exception) { null } }

    fun act(block: suspend () -> Unit, ok: String) {
        busy = true; message = null
        scope.launch { try { block(); message = ok; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("قيد يومية") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.description, style = MaterialTheme.typography.titleLarge)
                        Text("${o.number} · ${o.date}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                    }
                }
                Text("البنود (${o.lines.size})", style = MaterialTheme.typography.titleMedium)
                o.lines.forEach { l ->
                    AppCard(Modifier.fillMaxWidth()) {
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
                if (o.status == "DRAFT") {
                    Button(onClick = { act({ ServiceLocator.repo.postAction("api/v1/accounting/journal/$id/post") }, "تم الترحيل ✓") },
                        enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "…" else "ترحيل القيد") }
                    OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
                }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف مسودة القيد؟") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/journal/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}

// ---- Expenses (المصروفات) -------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExpenseFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var expAccounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var cashAccounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var expId by remember { mutableStateOf("") }
    var expName by remember { mutableStateOf("") }
    var cashId by remember { mutableStateOf("") }
    var cashName by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayIso()) }
    var payee by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var expPicker by remember { mutableStateOf(false) }
    var cashPicker by remember { mutableStateOf(false) }
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
            try { ServiceLocator.repo.expenseCreate(ExpenseCreateReq(expId, cashId, amt, date, "CASH", payee.ifBlank { null }, notes.ifBlank { null })); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("مصروف جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { expPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (expName.isBlank()) "بند المصروف *" else expName) }
            OutlinedButton(onClick = { cashPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (cashName.isBlank()) "من حساب (نقدية/بنك) *" else cashName) }
            OutlinedTextField(amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("المبلغ") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(date, { date = it }, label = { Text("التاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(payee, { payee = it }, label = { Text("المستفيد (اختياري)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (expPicker) AccountPickerDialog("بند المصروف", expAccounts, onDismiss = { expPicker = false }) { a -> expId = a.id; expName = "${a.number} ${a.title}"; expPicker = false }
    if (cashPicker) AccountPickerDialog("حساب النقدية/البنك", cashAccounts, onDismiss = { cashPicker = false }) { a -> cashId = a.id; cashName = "${a.number} ${a.title}"; cashPicker = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExpenseDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<ExpenseDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.expenseDetail(id) } catch (e: Exception) { null } }

    fun act(block: suspend () -> Unit, ok: String) {
        busy = true; message = null
        scope.launch { try { block(); message = ok; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("مصروف") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.account, style = MaterialTheme.typography.titleLarge)
                        Text("${o.number} · ${o.date}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                            Text(money(o.amount), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        }
                        Text("من: ${o.cashAccount}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        if (o.payee.isNotBlank()) Text("المستفيد: ${o.payee}", style = MaterialTheme.typography.bodySmall)
                        if (o.notes.isNotBlank()) Text(o.notes, style = MaterialTheme.typography.bodySmall)
                    }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                if (o.status == "DRAFT") {
                    Button(onClick = { act({ ServiceLocator.repo.postAction("api/v1/accounting/expenses/$id/confirm") }, "تم الترحيل ✓") },
                        enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "…" else "ترحيل المصروف") }
                    OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
                }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف مسودة المصروف؟") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/expenses/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}

// ---- Bank accounts (الحسابات البنكية) ------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BankManagerScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var reload by remember { mutableIntStateOf(0) }
    var actionFor by remember { mutableStateOf<DocRow?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { rows = try { ServiceLocator.repo.docList("api/v1/accounting/banks") } catch (e: Exception) { emptyList() } }

    Scaffold(
        topBar = { TopAppBar(title = { Text("الحسابات البنكية") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } }) },
        floatingActionButton = { FloatingActionButton(onClick = { nav.navigate("bank_form") }) { Icon(Icons.Filled.Add, "إضافة") } },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(rows) { r ->
                    AppCard(Modifier.fillMaxWidth().clickable { actionFor = r }) {
                        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(r.title, style = MaterialTheme.typography.titleSmall)
                                if (!r.subtitle.isNullOrBlank()) Text(r.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            }
                            r.status?.let { AssistChip(onClick = {}, label = { Text(it) }) }
                        }
                    }
                }
            }
        }
    }

    actionFor?.let { r ->
        AlertDialog(
            onDismissRequest = { actionFor = null },
            title = { Text(r.title) },
            text = { Text("اختر إجراءً") },
            confirmButton = {
                TextButton(onClick = {
                    val id = r.id; actionFor = null
                    scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/banks/$id/toggle"); reload++ } catch (e: Exception) { message = e.message } }
                }) { Text("تفعيل/إيقاف") }
            },
            dismissButton = {
                TextButton(onClick = {
                    val id = r.id; actionFor = null
                    scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/banks/$id/delete"); reload++ } catch (e: Exception) { message = e.message } }
                }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BankFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var glAccounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var nameAr by remember { mutableStateOf("") }
    var bankName by remember { mutableStateOf("") }
    var accountNumber by remember { mutableStateOf("") }
    var iban by remember { mutableStateOf("") }
    var glId by remember { mutableStateOf("") }
    var glName by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var glPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { glAccounts = try { ServiceLocator.repo.accounts("ASSET") } catch (e: Exception) { emptyList() } }

    fun save() {
        if (nameAr.isBlank()) { error = "اسم الحساب مطلوب"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.bankSave(BankSaveReq(null, nameAr, bankName.ifBlank { null }, accountNumber.ifBlank { null }, iban.ifBlank { null }, glId.ifBlank { null }, notes.ifBlank { null })); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("حساب بنكي جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(nameAr, { nameAr = it }, label = { Text("اسم الحساب *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(bankName, { bankName = it }, label = { Text("اسم البنك") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(accountNumber, { accountNumber = it }, label = { Text("رقم الحساب") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(iban, { iban = it }, label = { Text("IBAN") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { glPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (glName.isBlank()) "الحساب الدفتري (اختياري)" else glName) }
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (glPicker) AccountPickerDialog("الحساب الدفتري", glAccounts, onDismiss = { glPicker = false }) { a -> glId = a.id; glName = "${a.number} ${a.title}"; glPicker = false }
}
