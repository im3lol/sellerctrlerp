package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Checkbox
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
import com.sellerctrl.app.data.ItemCodeIn
import com.sellerctrl.app.data.ItemSaveReq
import kotlinx.coroutines.launch

private data class CodeRow(var type: String, var code: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemFormScreen(nav: NavController, id: String) {
    val isNew = id == "new"
    val scope = rememberCoroutineScope()
    var loaded by remember { mutableStateOf(isNew) }
    var code by remember { mutableStateOf("") }
    var nameAr by remember { mutableStateOf("") }
    var nameEn by remember { mutableStateOf("") }
    var sellPrice by remember { mutableStateOf("") }
    var minStock by remember { mutableStateOf("") }
    var isPerishable by remember { mutableStateOf(false) }
    val codes = remember { mutableStateListOf<CodeRow>() }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) {
        if (!isNew) {
            try {
                val it = ServiceLocator.repo.itemEdit(id)
                code = it.code; nameAr = it.nameAr; nameEn = it.nameEn; sellPrice = fmt(it.sellPrice); minStock = fmt(it.minStock); isPerishable = it.isPerishable
                it.codes.forEach { c -> codes.add(CodeRow(c.codeType, c.code)) }
            } catch (e: Exception) { error = e.message ?: "تعذّر التحميل" }
            loaded = true
        }
    }

    fun save() {
        if (code.isBlank()) { error = "الكود الداخلي مطلوب"; return }
        if (nameAr.trim().length < 2) { error = "الاسم قصير جداً"; return }
        val payloadCodes = codes.filter { it.type.isNotBlank() && it.code.isNotBlank() }.map { ItemCodeIn(it.type.trim(), it.code.trim()) }
        busy = true; error = null
        scope.launch {
            try {
                ServiceLocator.repo.itemSave(ItemSaveReq(if (isNew) null else id, code.trim(), nameAr.trim(), nameEn.ifBlank { null },
                    sellPrice.toDoubleOrNull() ?: 0.0, minStock.toDoubleOrNull() ?: 0.0, isPerishable, payloadCodes))
                nav.popBackStack()
            } catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(if (isNew) "صنف جديد" else "تعديل صنف") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(code, { code = it }, label = { Text("الكود الداخلي *") }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = isNew)
            OutlinedTextField(nameAr, { nameAr = it }, label = { Text("الاسم بالعربية *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(nameEn, { nameEn = it }, label = { Text("الاسم بالإنجليزية") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(sellPrice, { sellPrice = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("سعر البيع") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                OutlinedTextField(minStock, { minStock = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("حد أدنى") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
            }
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(isPerishable, { isPerishable = it }); Text("قابل للتلف (صلاحية)") }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("الأكواد/الباركود (${codes.size})", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { codes.add(CodeRow("BARCODE", "")) }) { Icon(Icons.Filled.Add, null); Text(" كود") }
            }
            codes.forEachIndexed { i, c ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(c.type, { v -> codes[i] = c.copy(type = v) }, label = { Text("النوع") }, singleLine = true, modifier = Modifier.width(120.dp))
                        OutlinedTextField(c.code, { v -> codes[i] = c.copy(code = v) }, label = { Text("الكود") }, singleLine = true, modifier = Modifier.weight(1f))
                        IconButton(onClick = { codes.removeAt(i) }) { Icon(Icons.Filled.Close, "حذف") }
                    }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
            if (!isNew) OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف الصنف") }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف الصنف؟ (يُرفض لو له حركة مخزون)") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; error = null
                scope.launch { try { ServiceLocator.repo.itemDelete(id); nav.popBackStack() } catch (e: Exception) { error = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}
