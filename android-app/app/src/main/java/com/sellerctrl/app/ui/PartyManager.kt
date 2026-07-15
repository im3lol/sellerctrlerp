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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.DocRow
import com.sellerctrl.app.data.PartySaveReq
import kotlinx.coroutines.launch

private fun singular(type: String) = if (type == "suppliers") "مورد" else "عميل"

/** Master-data manager for suppliers/customers — list + add + edit + delete. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PartyManagerScreen(nav: NavController, type: String, title: String) {
    var rows by remember { mutableStateOf<List<DocRow>?>(null) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(tick) {
        rows = try { ServiceLocator.repo.docList("api/v1/parties/$type") } catch (e: Exception) { emptyList() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
                actions = { val open = LocalOpenDrawer.current; IconButton(onClick = open) { Icon(Icons.Filled.Menu, "القائمة") } },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { nav.navigate("party_form/$type/new") }) { Icon(Icons.Filled.Add, "إضافة") }
        },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            when {
                rows == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                rows!!.isEmpty() -> Text("لا يوجد ${singular(type)}ون — أضِف بالزر +", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(rows!!) { r ->
                        Card(Modifier.fillMaxWidth().clickable { nav.navigate("party_form/$type/${r.id}") }) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(r.title, style = MaterialTheme.typography.titleSmall)
                                    Text("${r.number}${r.subtitle?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                }
                                r.amount?.let { AssistChip(onClick = {}, label = { Text(money(it)) }) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Add/edit form for a supplier/customer. `id == "new"` creates. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PartyFormScreen(nav: NavController, type: String, id: String) {
    val editing = id != "new"
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var terms by remember { mutableStateOf("30") }
    var credit by remember { mutableStateOf("0") }
    var loading by remember { mutableStateOf(editing) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(id) {
        if (editing) {
            try {
                val d = ServiceLocator.repo.partyDetail(type, id)
                code = d.code; name = d.nameAr; phone = d.phone; email = d.email
                terms = d.paymentTerms.toString(); credit = fmt(d.creditLimit)
            } catch (e: Exception) { error = "تعذّر تحميل البيانات" }
            loading = false
        }
    }

    fun save() {
        if (code.isBlank() || name.isBlank()) { error = "الكود والاسم مطلوبان"; return }
        busy = true; error = null
        scope.launch {
            try {
                ServiceLocator.repo.partySave(type, PartySaveReq(
                    id = if (editing) id else null, code = code.trim(), nameAr = name.trim(),
                    phone = phone.ifBlank { null }, email = email.ifBlank { null },
                    paymentTerms = terms.toIntOrNull() ?: 30,
                    creditLimit = if (type == "customers") credit.toDoubleOrNull() ?: 0.0 else null,
                ))
                nav.popBackStack()
            } catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    fun del() {
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.partyDelete(type, id); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (editing) "تعديل ${singular(type)}" else "${singular(type)} جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            actions = { if (editing) IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, "حذف") } },
        )
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            if (loading) {
                CircularProgressIndicator(Modifier.align(Alignment.Center))
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(code, { code = it }, label = { Text("الكود *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(name, { name = it }, label = { Text("الاسم *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(phone, { phone = it }, label = { Text("الهاتف") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(email, { email = it }, label = { Text("البريد الإلكتروني") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(terms, { terms = it.filter { c -> c.isDigit() } }, label = { Text("مهلة السداد (يوم)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                    if (type == "customers") {
                        OutlinedTextField(credit, { credit = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("حد الائتمان") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                    }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
                    Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Text(if (busy) "جارٍ الحفظ…" else "حفظ")
                    }
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("حذف ${singular(type)}") },
            text = { Text("متأكد من حذف \"$name\"؟") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; del() }) { Text("حذف", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
        )
    }
}
