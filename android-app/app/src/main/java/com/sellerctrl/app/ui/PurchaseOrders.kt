package com.sellerctrl.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.PoCreateLine
import com.sellerctrl.app.data.PoCreateReq
import kotlinx.coroutines.launch

private data class PoLine(val itemId: String, val name: String, var qty: String, var price: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PurchaseOrderFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var suppliers by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var warehouses by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var supplierId by remember { mutableStateOf("") }
    var supplierName by remember { mutableStateOf("") }
    var warehouseId by remember { mutableStateOf("") }
    var warehouseName by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(todayIso()) }
    var notes by remember { mutableStateOf("") }
    val lines = remember { mutableStateListOf<PoLine>() }
    var itemPicker by remember { mutableStateOf(false) }
    var supPicker by remember { mutableStateOf(false) }
    var whPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        suppliers = try { ServiceLocator.repo.docList("api/v1/parties/suppliers").map { it.id to it.title } } catch (e: Exception) { emptyList() }
        warehouses = try { ServiceLocator.repo.warehouses().map { it.id to it.name } } catch (e: Exception) { emptyList() }
    }

    fun total(): Double = lines.sumOf { (it.qty.toDoubleOrNull() ?: 0.0) * (it.price.toDoubleOrNull() ?: 0.0) }

    fun save() {
        if (supplierId.isBlank()) { error = "اختر المورد"; return }
        if (warehouseId.isBlank()) { error = "اختر المستودع"; return }
        if (lines.isEmpty()) { error = "أضف صنفاً واحداً على الأقل"; return }
        val payload = lines.map { l ->
            val q = l.qty.toDoubleOrNull(); val p = l.price.toDoubleOrNull()
            if (q == null || q <= 0 || p == null || p < 0) return@save run { error = "تحقّق من الكميات والأسعار" }
            PoCreateLine(l.itemId, q, p)
        }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.purchaseOrderCreate(PoCreateReq(supplierId, warehouseId, date, notes.ifBlank { null }, payload)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("أمر شراء جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            androidx.compose.material3.OutlinedButton(onClick = { supPicker = true }, modifier = Modifier.fillMaxWidth()) {
                Text(if (supplierName.isBlank()) "اختر المورد *" else "المورد: $supplierName")
            }
            androidx.compose.material3.OutlinedButton(onClick = { whPicker = true }, modifier = Modifier.fillMaxWidth()) {
                Text(if (warehouseName.isBlank()) "اختر المستودع *" else "المستودع: $warehouseName")
            }
            OutlinedTextField(date, { date = it }, label = { Text("التاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("البنود (${lines.size})", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { itemPicker = true }) { Icon(Icons.Filled.Add, null); Text(" إضافة صنف") }
            }
            lines.forEachIndexed { i, l ->
                AppCard(Modifier.fillMaxWidth()) {
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

    if (supPicker) OptionPickerDialog("اختر المورد", suppliers, onDismiss = { supPicker = false }) { id, label -> supplierId = id; supplierName = label; supPicker = false }
    if (whPicker) OptionPickerDialog("اختر المستودع", warehouses, onDismiss = { whPicker = false }) { id, label -> warehouseId = id; warehouseName = label; whPicker = false }
    if (itemPicker) ItemPickerDialog(onDismiss = { itemPicker = false }) { item ->
        itemPicker = false
        if (lines.none { it.itemId == item.id }) lines.add(PoLine(item.id, item.name, "1", fmt(item.sellPrice)))
    }
}

@Composable
internal fun OptionPickerDialog(title: String, options: List<Pair<String, String>>, onDismiss: () -> Unit, onPick: (String, String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
                items(options) { (id, label) ->
                    Text(label, Modifier.fillMaxWidth().clickable { onPick(id, label) }.padding(vertical = 12.dp), style = MaterialTheme.typography.bodyLarge)
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("إغلاق") } },
    )
}
