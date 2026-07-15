package com.sellerctrl.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
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
import com.sellerctrl.app.data.BankStatementDto
import com.sellerctrl.app.data.DocRow
import com.sellerctrl.app.data.StatementLineDto
import com.sellerctrl.app.data.StatementLineReq
import kotlinx.coroutines.launch

/** Bank picker for reconciliation: reuse the banks list; tap → recon/{id}. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BankReconListScreen(nav: NavController) {
    var rows by remember { mutableStateOf<List<DocRow>?>(null) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(tick) { rows = try { ServiceLocator.repo.docList("api/v1/accounting/banks") } catch (e: Exception) { emptyList() } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("المطابقة البنكية") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val r = rows
            when {
                r == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                r.isEmpty() -> Text("لا توجد حسابات بنكية", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(r) { b ->
                        Card(Modifier.fillMaxWidth().clickable { nav.navigate("recon/${b.id}") }) {
                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(b.title, style = MaterialTheme.typography.titleSmall)
                                    if (!b.subtitle.isNullOrBlank()) Text(b.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                }
                                Text("مطابقة ›", color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BankReconScreen(nav: NavController, bankId: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<BankStatementDto?>(null) }
    var addOpen by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.bankStatement(bankId) } catch (e: Exception) { null } }

    fun act(path: String) {
        scope.launch { try { ServiceLocator.repo.postAction(path); reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(d?.bankName ?: "المطابقة") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } }) },
        floatingActionButton = { FloatingActionButton(onClick = { addOpen = true }) { Icon(Icons.Filled.Add, "إضافة سطر") } },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().padding(12.dp)) {
                Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column {
                            Text("مطابَق ${o.reconciledCount} · غير مطابَق ${o.unreconciledCount}", style = MaterialTheme.typography.bodyMedium)
                            Text("رصيد الكشف", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        }
                        Text(money(o.statementBalance), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(bottom = 6.dp)) }
                if (o.lines.isEmpty()) Text("لا توجد حركات — أضف سطر كشف بالزر +", Modifier.padding(top = 24.dp), color = MaterialTheme.colorScheme.outline)
                else LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(o.lines) { l -> StatementLineCard(l, onToggle = { act("api/v1/accounting/statement-lines/${l.id}/toggle") }, onDelete = { act("api/v1/accounting/statement-lines/${l.id}/delete") }) }
                }
            }
        }
    }

    if (addOpen) AddStatementLineDialog(bankId, onDismiss = { addOpen = false }, onDone = { addOpen = false; reload++ })
}

@Composable
private fun StatementLineCard(l: StatementLineDto, onToggle: () -> Unit, onDelete: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onToggle) {
                if (l.reconciled) Icon(Icons.Filled.CheckCircle, "مطابَق", tint = MaterialTheme.colorScheme.primary)
                else Icon(Icons.Outlined.Circle, "غير مطابَق", tint = MaterialTheme.colorScheme.outline)
            }
            Column(Modifier.weight(1f)) {
                Text(l.description.ifBlank { "—" }, style = MaterialTheme.typography.bodyMedium)
                Text(l.date + (if (l.reference.isNotBlank()) " · ${l.reference}" else ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            }
            Column(horizontalAlignment = Alignment.End) {
                if (l.debit > 0) Text("+${money(l.debit)}", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
                if (l.credit > 0) Text("-${money(l.credit)}", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, "حذف", tint = MaterialTheme.colorScheme.outline) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddStatementLineDialog(bankId: String, onDismiss: () -> Unit, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var date by remember { mutableStateOf(todayIso()) }
    var description by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var debit by remember { mutableStateOf("") }
    var credit by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun add() {
        val dv = debit.toDoubleOrNull() ?: 0.0; val cv = credit.toDoubleOrNull() ?: 0.0
        if (dv == 0.0 && cv == 0.0) { error = "أدخل مبلغاً (وارد أو صادر)"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.statementLineAdd(bankId, StatementLineReq(date, description.ifBlank { null }, reference.ifBlank { null }, dv, cv)); onDone() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("سطر كشف بنكي") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(date, { date = it }, label = { Text("التاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { description = it }, label = { Text("البيان") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(reference, { reference = it }, label = { Text("مرجع") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(debit, { debit = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("وارد") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                    OutlinedTextField(credit, { credit = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("صادر") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            }
        },
        confirmButton = { TextButton(onClick = { add() }, enabled = !busy) { Text(if (busy) "…" else "إضافة") } },
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}
