package com.sellerctrl.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
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
import com.sellerctrl.app.data.BudgetSaveLine
import com.sellerctrl.app.data.BudgetSaveReq
import com.sellerctrl.app.data.DocRow
import kotlinx.coroutines.launch

/** Budget years; tap a year to edit its per-account amounts, or + to start a new year. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BudgetYearsScreen(nav: NavController) {
    var rows by remember { mutableStateOf<List<DocRow>?>(null) }
    var addOpen by remember { mutableStateOf(false) }
    var newYear by remember { mutableStateOf(java.util.Calendar.getInstance().get(java.util.Calendar.YEAR).toString()) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(tick) { rows = try { ServiceLocator.repo.docList("api/v1/accounting/budget") } catch (e: Exception) { emptyList() } }

    Scaffold(
        topBar = { TopAppBar(title = { Text("الميزانية التقديرية") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } }) },
        floatingActionButton = { FloatingActionButton(onClick = { addOpen = true }) { Icon(Icons.Filled.Add, "سنة جديدة") } },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val r = rows
            when {
                r == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                r.isEmpty() -> Text("لا توجد ميزانيات — اضغط + لبدء سنة", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(r) { y ->
                        AppCard(Modifier.fillMaxWidth().clickable { nav.navigate("budget_year/${y.number}") }) {
                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(y.title, style = MaterialTheme.typography.titleSmall)
                                    y.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
                                }
                                y.amount?.let { Text(money(it), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary) }
                            }
                        }
                    }
                }
            }
        }
    }

    if (addOpen) AlertDialog(
        onDismissRequest = { addOpen = false },
        title = { Text("سنة ميزانية") },
        text = {
            OutlinedTextField(newYear, { newYear = it.filter { c -> c.isDigit() } }, label = { Text("السنة") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
        },
        confirmButton = {
            TextButton(onClick = {
                val y = newYear.toIntOrNull()
                if (y != null && y in 2000..2100) { addOpen = false; nav.navigate("budget_year/$y") }
            }) { Text("فتح") }
        },
        dismissButton = { OutlinedButton(onClick = { addOpen = false }) { Text("إلغاء") } },
    )
}

private data class BudgetRow(val accountId: String, val label: String, val type: String, var amount: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BudgetYearScreen(nav: NavController, year: String) {
    val scope = rememberCoroutineScope()
    val lines = remember { mutableStateListOf<BudgetRow>() }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(year) {
        try {
            val b = ServiceLocator.repo.budgetYear(year.toIntOrNull() ?: 0)
            b.lines.forEach { l -> lines.add(BudgetRow(l.accountId, "${l.code} ${l.name}", l.type, if (l.amount == 0.0) "" else fmt(l.amount))) }
        } catch (e: Exception) { error = e.message ?: "تعذّر التحميل" }
        loaded = true
    }

    fun total(): Double = lines.sumOf { it.amount.toDoubleOrNull() ?: 0.0 }

    fun save() {
        val payload = lines.filter { (it.amount.toDoubleOrNull() ?: 0.0) > 0 }.map { BudgetSaveLine(it.accountId, it.amount.toDouble()) }
        if (payload.isEmpty()) { error = "أدخل مبلغاً واحداً على الأقل"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.budgetSave(BudgetSaveReq(year.toIntOrNull() ?: 0, payload)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("ميزانية $year") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            if (!loaded) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().padding(12.dp)) {
                AppCard(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("إجمالي المُقدَّر", fontWeight = FontWeight.Bold)
                        Text(money(total()), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 6.dp)) }
                LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(lines.size) { i ->
                        val l = lines[i]
                        AppCard(Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(l.label, style = MaterialTheme.typography.bodyMedium)
                                    Text(l.type, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                }
                                OutlinedTextField(l.amount, { v -> lines[i] = l.copy(amount = v.filter { it.isDigit() || it == '.' }) },
                                    label = { Text("مُقدَّر") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                    modifier = Modifier.width(130.dp))
                            }
                        }
                    }
                }
                Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
            }
        }
    }
}
