package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

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
import com.sellerctrl.app.data.CollectReq
import com.sellerctrl.app.data.DocRow
import com.sellerctrl.app.data.OrderDetailDto
import com.sellerctrl.app.data.ReceivableDto
import com.sellerctrl.app.data.SiCreateLine
import com.sellerctrl.app.data.SiCreateReq
import com.sellerctrl.app.data.SoCreateLine
import com.sellerctrl.app.data.SoCreateReq
import kotlinx.coroutines.launch

internal data class SLine(val itemId: String, val name: String, var qty: String, var price: String)

/** Shared sales create form: sales order (with warehouse), standalone invoice, or quotation. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SalesForm(nav: NavController, title: String, withWarehouse: Boolean, submit: suspend (custId: String, whId: String, date: String, notes: String, lines: List<SLine>) -> Unit) {
    val scope = rememberCoroutineScope()
    var customers by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var warehouses by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var custId by remember { mutableStateOf("") }
    var custName by remember { mutableStateOf("") }
    var whId by remember { mutableStateOf("") }
    var whName by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayIso()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<SLine>() }
    var itemPicker by remember { mutableStateOf(false) }
    var custPicker by remember { mutableStateOf(false) }
    var whPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        customers = try { ServiceLocator.repo.docList("api/v1/parties/customers").map { it.id to it.title } } catch (e: Exception) { emptyList() }
        if (withWarehouse) warehouses = try { ServiceLocator.repo.warehouses().map { it.id to it.name } } catch (e: Exception) { emptyList() }
    }

    fun total(): Double = lines.sumOf { (it.qty.toDoubleOrNull() ?: 0.0) * (it.price.toDoubleOrNull() ?: 0.0) }

    fun save() {
        if (custId.isBlank()) { error = tr("اختر العميل"); return }
        if (withWarehouse && whId.isBlank()) { error = tr("اختر المستودع"); return }
        if (lines.isEmpty()) { error = tr("أضف صنفاً واحداً على الأقل"); return }
        lines.forEach { l ->
            val q = l.qty.toDoubleOrNull(); val p = l.price.toDoubleOrNull()
            if (q == null || q <= 0 || p == null || p < 0) { error = tr("تحقّق من الكميات والأسعار"); return }
        }
        busy = true; error = null
        scope.launch {
            try { submit(custId, whId, date, notes, lines.toList()); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: tr("خطأ"); busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { custPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (custName.isBlank()) tr("اختر العميل *") else tr("العميل: $custName")) }
            if (withWarehouse) OutlinedButton(onClick = { whPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (whName.isBlank()) tr("اختر المستودع *") else tr("المستودع: $whName")) }
            OutlinedTextField(date, { date = it }, label = { Text(tr("التاريخ")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text(tr("ملاحظات")) }, modifier = Modifier.fillMaxWidth())

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(tr("البنود (${lines.size})"), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { itemPicker = true }) { Icon(Icons.Filled.Add, null); Text(tr(" إضافة صنف")) }
            }
            lines.forEachIndexed { i, l ->
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(l.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Filled.Close, tr("حذف")) }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(l.qty, { v -> lines[i] = l.copy(qty = v.filter { it.isDigit() || it == '.' }) }, label = { Text(tr("كمية")) }, singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                            OutlinedTextField(l.price, { v -> lines[i] = l.copy(price = v.filter { it.isDigit() || it == '.' }) }, label = { Text(tr("سعر الوحدة")) }, singleLine = true,
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
            if (lines.isNotEmpty()) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(tr("الإجمالي"), fontWeight = FontWeight.Bold)
                Text(money(total()), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) tr("جارٍ الحفظ…") else tr("حفظ")) }
        }
    }

    if (custPicker) OptionPickerDialog(tr("اختر العميل"), customers, onDismiss = { custPicker = false }) { id, label -> custId = id; custName = label; custPicker = false }
    if (whPicker) OptionPickerDialog(tr("اختر المستودع"), warehouses, onDismiss = { whPicker = false }) { id, label -> whId = id; whName = label; whPicker = false }
    if (itemPicker) ItemPickerDialog(onDismiss = { itemPicker = false }) { item ->
        itemPicker = false
        if (lines.none { it.itemId == item.id }) lines.add(SLine(item.id, item.name, "1", fmt(item.sellPrice)))
    }
}

@Composable
fun SalesOrderFormScreen(nav: NavController) {
    SalesForm(nav, tr("أمر بيع جديد"), withWarehouse = true) { custId, whId, date, notes, lines ->
        ServiceLocator.repo.salesOrderCreate(SoCreateReq(custId, date, notes.ifBlank { null },
            lines.map { SoCreateLine(it.itemId, whId, it.qty.toDouble(), it.price.toDouble()) }))
    }
}

@Composable
fun SalesInvoiceFormScreen(nav: NavController) {
    SalesForm(nav, tr("فاتورة بيع جديدة"), withWarehouse = false) { custId, _, date, notes, lines ->
        ServiceLocator.repo.salesInvoiceCreate(SiCreateReq(custId, date, notes.ifBlank { null },
            lines.map { SiCreateLine(it.itemId, it.qty.toDouble(), it.price.toDouble()) }))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SalesInvoiceDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<OrderDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var collectOpen by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.orderDetail("api/v1/sales/invoices/$id") } catch (e: Exception) { null } }

    fun act(block: suspend () -> Unit, ok: String) {
        busy = true; message = null
        scope.launch { try { block(); message = ok; reload++ } catch (e: Exception) { message = e.message ?: tr("خطأ") } finally { busy = false } }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(tr("فاتورة بيع")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.party, style = MaterialTheme.typography.titleLarge)
                        Text("${o.number} · ${o.date}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                            Text(money(o.total), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                Text(tr("البنود (${o.lines.size})"), style = MaterialTheme.typography.titleMedium)
                o.lines.forEach { l ->
                    AppCard(Modifier.fillMaxWidth()) {
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
                if (o.status == "DRAFT") {
                    Button(onClick = { act({ ServiceLocator.repo.postAction("api/v1/sales/invoices/$id/post") }, tr("تم الترحيل ✓")) },
                        enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "…" else tr("ترحيل الفاتورة")) }
                    OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(tr("حذف")) }
                }
                if (o.status == "POSTED" || o.status == "PARTIAL_PAID" || o.status == "UNPAID" || o.status == "OVERDUE") {
                    Button(onClick = { collectOpen = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(tr("سند قبض / تحصيل")) }
                }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text(tr("حذف")) }, text = { Text(tr("متأكد من حذف مسودة الفاتورة؟")) },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/sales/invoices/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: tr("خطأ") } finally { busy = false } }
            }) { Text(tr("حذف"), color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text(tr("إلغاء")) } },
    )

    if (collectOpen) CollectDialog(invoiceId = id, onDismiss = { collectOpen = false }, onDone = { collectOpen = false; message = tr("تم التحصيل ✓"); reload++ })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CollectDialog(invoiceId: String, onDismiss: () -> Unit, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var recv by remember { mutableStateOf<ReceivableDto?>(null) }
    var accounts by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var accountId by remember { mutableStateOf("") }
    var accountName by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayIso()) }
    var acctPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        recv = try { ServiceLocator.repo.invoiceReceivable(invoiceId) } catch (e: Exception) { null }
        amount = recv?.let { fmt(it.balanceDue) } ?: ""
        accounts = try { ServiceLocator.repo.cashAccounts() } catch (e: Exception) { emptyList() }
    }

    fun collect() {
        val r = recv ?: return
        val amt = amount.toDoubleOrNull()
        if (amt == null || amt <= 0) { error = tr("مبلغ غير صالح"); return }
        if (amt > r.balanceDue + 0.001) { error = tr("المبلغ أكبر من المتبقّي (${fmt(r.balanceDue)})"); return }
        if (accountId.isBlank()) { error = tr("اختر حساب النقدية/البنك"); return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.collectInvoice(CollectReq(r.customerId, invoiceId, accountId, amt, date)); onDone() }
            catch (e: Exception) { error = e.message ?: tr("خطأ"); busy = false }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(tr("سند قبض")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                recv?.let { Text(tr("المتبقّي: ${money(it.balanceDue)}"), color = MaterialTheme.colorScheme.outline) }
                OutlinedTextField(amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text(tr("المبلغ")) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = { acctPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (accountName.isBlank()) tr("حساب النقدية/البنك *") else accountName) }
                OutlinedTextField(date, { date = it }, label = { Text(tr("التاريخ")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            }
        },
        confirmButton = { TextButton(onClick = { collect() }, enabled = !busy) { Text(if (busy) "…" else tr("تحصيل")) } },
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text(tr("إلغاء")) } },
    )

    if (acctPicker) OptionPickerDialog(tr("حساب النقدية/البنك"), accounts.map { it.id to "${it.number} · ${it.title}" }, onDismiss = { acctPicker = false }) { aid, label ->
        accountId = aid; accountName = label; acctPicker = false
    }
}
