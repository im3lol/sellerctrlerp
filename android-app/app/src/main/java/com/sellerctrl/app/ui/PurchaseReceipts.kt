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
import com.sellerctrl.app.data.ReceiptCreateReq
import com.sellerctrl.app.data.ReceiptDetailDto
import com.sellerctrl.app.data.ReceiptPick
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PurchaseReceiptDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<ReceiptDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.receiptDetail(id) } catch (e: Exception) { null } }

    fun act(block: suspend () -> Unit, ok: String) {
        busy = true; message = null
        scope.launch {
            try { block(); message = ok; reload++ }
            catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("إذن استلام") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.supplier, style = MaterialTheme.typography.titleLarge)
                        Text("${o.number} · ${o.date}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        if (o.poNumber.isNotBlank()) Text("من أمر: ${o.poNumber}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                    }
                }
                Text("البنود (${o.lines.size})", style = MaterialTheme.typography.titleMedium)
                o.lines.forEach { l ->
                    AppCard(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(l.name, modifier = Modifier.weight(1f))
                            Column(horizontalAlignment = Alignment.End) {
                                Text("مستلم: ${fmt(l.qty)}", color = MaterialTheme.colorScheme.outline)
                                if (l.rejected > 0) Text("مرفوض: ${fmt(l.rejected)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }

                if (o.status == "DRAFT") {
                    Button(onClick = { act({ ServiceLocator.repo.postAction("api/v1/purchases/receipts/$id/confirm") }, "تم تأكيد الاستلام ✓") },
                        enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "…" else "تأكيد الاستلام") }
                    OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
                }
                if (o.status == "RECEIVED" && !o.invoiced) {
                    Button(onClick = {
                        busy = true; message = null
                        scope.launch {
                            try {
                                val invId = ServiceLocator.repo.receiptBill(id)
                                if (invId != null) nav.navigate("purchase_invoice/$invId") else { message = "تم إنشاء الفاتورة"; reload++ }
                            } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false }
                        }
                    }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "…" else "فوترة") }
                }
                if (o.invoiced) Text("تم إنشاء فاتورة لهذا الإذن ✓", color = MaterialTheme.colorScheme.primary)
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("حذف") },
        text = { Text("متأكد من حذف مسودة إذن الاستلام؟") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch {
                    try { ServiceLocator.repo.postAction("api/v1/purchases/receipts/$id/delete"); nav.popBackStack() }
                    catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false }
                }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}

private data class RcvLine(val itemId: String, val name: String, val remaining: Double, var qty: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PurchaseReceiptFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var pos by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var poId by remember { mutableStateOf("") }
    var poLabel by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayIso()) }
    val lines = remember { mutableStateListOf<RcvLine>() }
    var poPicker by remember { mutableStateOf(false) }
    var loadingLines by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        pos = try { ServiceLocator.repo.receivableOrders() } catch (e: Exception) { emptyList() }
    }

    fun loadLines(id: String) {
        loadingLines = true; lines.clear(); error = null
        scope.launch {
            try {
                val data = ServiceLocator.repo.receivableLines(id)
                data.lines.forEach { lines.add(RcvLine(it.itemId, it.name.ifBlank { it.code }, it.remaining, fmt(it.remaining))) }
                if (lines.isEmpty()) error = "لا توجد كميات متبقّية للاستلام"
            } catch (e: Exception) { error = e.message ?: "خطأ" } finally { loadingLines = false }
        }
    }

    fun save() {
        if (poId.isBlank()) { error = "اختر أمر الشراء"; return }
        if (lines.isEmpty()) { error = "لا توجد بنود"; return }
        val picks = lines.map { l ->
            val q = l.qty.toDoubleOrNull()
            if (q == null || q < 0 || q > l.remaining + 1e-6) return@save run { error = "الكمية لـ${l.name} يجب ألا تتجاوز المتبقّي (${fmt(l.remaining)})" }
            ReceiptPick(l.itemId, q)
        }.filter { it.quantity > 0 }
        if (picks.isEmpty()) { error = "أدخل كمية واحدة على الأقل"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.receiptCreate(ReceiptCreateReq(poId, date, picks)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("إذن استلام جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { poPicker = true }, modifier = Modifier.fillMaxWidth()) {
                Text(if (poLabel.isBlank()) "اختر أمر الشراء *" else "الأمر: $poLabel")
            }
            OutlinedTextField(date, { date = it }, label = { Text("تاريخ الاستلام") }, singleLine = true, modifier = Modifier.fillMaxWidth())

            if (loadingLines) CircularProgressIndicator()
            if (lines.isNotEmpty()) Text("البنود المستلمة (${lines.size})", style = MaterialTheme.typography.titleMedium)
            lines.forEachIndexed { i, l ->
                AppCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(l.name, style = MaterialTheme.typography.bodyMedium)
                            Text("المتبقّي: ${fmt(l.remaining)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        }
                        OutlinedTextField(l.qty, { v -> lines[i] = l.copy(qty = v.filter { it.isDigit() || it == '.' }) },
                            label = { Text("مستلم") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            modifier = Modifier.width(120.dp))
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy && lines.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (poPicker) OptionPickerDialog("اختر أمر الشراء", pos.map { it.id to "${it.subtitle ?: it.number} · ${it.title}" }, onDismiss = { poPicker = false }) { id, label ->
        poId = id; poLabel = label; poPicker = false; loadLines(id)
    }
}
