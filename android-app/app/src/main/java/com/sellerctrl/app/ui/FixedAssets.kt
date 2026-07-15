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
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
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
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
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
import com.sellerctrl.app.data.AssetCreateReq
import com.sellerctrl.app.data.AssetDetailDto
import kotlinx.coroutines.launch

private val CATEGORIES = listOf(
    "BUILDING" to "مبانٍ", "VEHICLE" to "مركبات", "EQUIPMENT" to "معدات",
    "FURNITURE" to "أثاث", "IT" to "تقنية", "OTHER" to "أخرى",
)
private fun catAr(c: String) = CATEGORIES.firstOrNull { it.first == c }?.second ?: c

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssetFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var nameAr by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("OTHER") }
    var purchaseDate by remember { mutableStateOf(todayIso()) }
    var cost by remember { mutableStateOf("") }
    var salvage by remember { mutableStateOf("") }
    var life by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var catPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save() {
        if (code.isBlank()) { error = "الكود مطلوب"; return }
        if (nameAr.trim().length < 2) { error = "الاسم قصير جداً"; return }
        val c = cost.toDoubleOrNull(); val l = life.toIntOrNull()
        if (c == null || c < 0) { error = "تكلفة غير صالحة"; return }
        if (l == null || l <= 0) { error = "العمر الإنتاجي يجب أن يكون أكبر من صفر"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.assetCreate(AssetCreateReq(code.trim(), nameAr.trim(), category, purchaseDate, c, salvage.toDoubleOrNull() ?: 0.0, l, notes.ifBlank { null })); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("أصل ثابت جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(code, { code = it }, label = { Text("الكود *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(nameAr, { nameAr = it }, label = { Text("اسم الأصل *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = { catPicker = true }, modifier = Modifier.fillMaxWidth()) { Text("الفئة: ${catAr(category)}") }
            OutlinedTextField(purchaseDate, { purchaseDate = it }, label = { Text("تاريخ الشراء") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(cost, { cost = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("التكلفة *") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                OutlinedTextField(salvage, { salvage = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("قيمة الخردة") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
            }
            OutlinedTextField(life, { life = it.filter { c -> c.isDigit() } }, label = { Text("العمر الإنتاجي (سنوات) *") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
            Text("ملاحظة: ربط حسابات الإهلاك يتم من نسخة الويب.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        }
    }

    if (catPicker) OptionPickerDialog("الفئة", CATEGORIES.map { it.first to it.second }, onDismiss = { catPicker = false }) { id, _ -> category = id; catPicker = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AssetDetailScreen(nav: NavController, id: String) {
    var d by remember { mutableStateOf<AssetDetailDto?>(null) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(id, tick) { d = try { ServiceLocator.repo.assetDetail(id) } catch (e: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("أصل ثابت") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.nameAr, style = MaterialTheme.typography.titleLarge)
                        Text("${o.code} · ${catAr(o.category)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                    }
                }
                AssetRow("تاريخ الشراء", o.purchaseDate)
                AssetRow("التكلفة", money(o.purchaseCost))
                AssetRow("قيمة الخردة", money(o.salvageValue))
                AssetRow("العمر الإنتاجي", "${o.usefulLifeYears} سنة")
                AssetRow("مجمع الإهلاك", money(o.accumulated))
                AssetRow("القيمة الدفترية", money(o.netBookValue))
                if (o.notes.isNotBlank()) AssetRow("ملاحظات", o.notes)
            }
        }
    }
}

@Composable
private fun AssetRow(label: String, value: String) {
    Card(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, color = MaterialTheme.colorScheme.outline)
            Text(value, fontWeight = FontWeight.SemiBold)
        }
    }
}
