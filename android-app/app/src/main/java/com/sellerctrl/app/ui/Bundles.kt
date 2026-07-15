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
import com.sellerctrl.app.data.AssembleReq
import com.sellerctrl.app.data.BomComponent
import com.sellerctrl.app.data.BomReq
import com.sellerctrl.app.data.BundleDetailDto
import kotlinx.coroutines.launch

private data class CompRow(val itemId: String, val name: String, var qty: String)

/** Set/edit a kit's bill of materials. id="new" → pick a parent item; else parent fixed + prefilled. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BundleFormScreen(nav: NavController, id: String) {
    val isNew = id == "new"
    val scope = rememberCoroutineScope()
    var loaded by remember { mutableStateOf(isNew) }
    var parentId by remember { mutableStateOf(if (isNew) "" else id) }
    var parentName by remember { mutableStateOf("") }
    val comps = remember { mutableStateListOf<CompRow>() }
    var parentPicker by remember { mutableStateOf(false) }
    var compPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) {
        if (!isNew) {
            try {
                val b = ServiceLocator.repo.bundleDetail(id)
                parentName = "${b.code} ${b.name}"
                b.components.forEach { c -> comps.add(CompRow(c.itemId, c.name, fmt(c.qty))) }
            } catch (e: Exception) { error = e.message ?: "تعذّر التحميل" }
            loaded = true
        }
    }

    fun save() {
        if (parentId.isBlank()) { error = "اختر صنف الحزمة"; return }
        if (comps.isEmpty()) { error = "أضف مكوّناً واحداً على الأقل"; return }
        val payload = comps.map { c ->
            val q = c.qty.toDoubleOrNull()
            if (q == null || q <= 0) return@save run { error = "تحقّق من كمية ${c.name}" }
            BomComponent(c.itemId, q)
        }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.bundleSetComponents(BomReq(parentId, payload)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(if (isNew) "حزمة جديدة" else "تعديل مكوّنات الحزمة") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { if (isNew) parentPicker = true }, enabled = isNew, modifier = Modifier.fillMaxWidth()) {
                Text(if (parentName.isBlank()) "اختر صنف الحزمة *" else "الحزمة: $parentName")
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("المكوّنات (${comps.size})", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { compPicker = true }) { Icon(Icons.Filled.Add, null); Text(" مكوّن") }
            }
            comps.forEachIndexed { i, c ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(c.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        OutlinedTextField(c.qty, { v -> comps[i] = c.copy(qty = v.filter { it.isDigit() || it == '.' }) }, label = { Text("كمية") }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.width(110.dp))
                        IconButton(onClick = { comps.removeAt(i) }) { Icon(Icons.Filled.Close, "حذف") }
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (parentPicker) ItemPickerDialog(onDismiss = { parentPicker = false }) { item -> parentId = item.id; parentName = "${item.code} ${item.name}"; parentPicker = false }
    if (compPicker) ItemPickerDialog(onDismiss = { compPicker = false }) { item ->
        compPicker = false
        if (item.id != parentId && comps.none { it.itemId == item.id }) comps.add(CompRow(item.id, item.name, "1"))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BundleDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<BundleDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var assembleOpen by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.bundleDetail(id) } catch (e: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("حزمة") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.name, style = MaterialTheme.typography.titleLarge)
                        Text(o.code, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                    }
                }
                Text("المكوّنات (${o.components.size})", style = MaterialTheme.typography.titleMedium)
                o.components.forEach { c ->
                    Card(Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column(Modifier.weight(1f)) {
                                Text(c.name, style = MaterialTheme.typography.titleSmall)
                                Text(c.code, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            }
                            Text("× ${fmt(c.qty)}", fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                Button(onClick = { assembleOpen = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("تجميع كميات") }
                OutlinedButton(onClick = { nav.navigate("bundle_form/$id") }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("تعديل المكوّنات") }
                OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف الحزمة") }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("إزالة مكوّنات الحزمة؟ (يبقى الصنف عاديًا)") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/inventory/bundles/$id/delete"); nav.popBackStack() } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )

    if (assembleOpen) AssembleDialog(kitItemId = id, onDismiss = { assembleOpen = false }, onDone = { assembleOpen = false; message = "تم التجميع ✓"; reload++ })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AssembleDialog(kitItemId: String, onDismiss: () -> Unit, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var warehouses by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var whId by remember { mutableStateOf("") }
    var whName by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("1") }
    var date by remember { mutableStateOf(todayIso()) }
    var whPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) { warehouses = try { ServiceLocator.repo.warehouses().map { it.id to it.name } } catch (e: Exception) { emptyList() } }

    fun run() {
        val q = qty.toDoubleOrNull()
        if (q == null || q <= 0) { error = "كمية غير صالحة"; return }
        if (whId.isBlank()) { error = "اختر المستودع"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.bundleAssemble(AssembleReq(kitItemId, whId, q, date)); onDone() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تجميع الحزمة") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { whPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (whName.isBlank()) "المستودع *" else whName) }
                OutlinedTextField(qty, { qty = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("الكمية") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(date, { date = it }, label = { Text("التاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            }
        },
        confirmButton = { TextButton(onClick = { run() }, enabled = !busy) { Text(if (busy) "…" else "تجميع") } },
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text("إلغاء") } },
    )

    if (whPicker) OptionPickerDialog("المستودع", warehouses, onDismiss = { whPicker = false }) { id, label -> whId = id; whName = label; whPicker = false }
}
