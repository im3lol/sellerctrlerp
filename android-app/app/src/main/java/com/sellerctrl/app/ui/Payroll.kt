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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.PayrollCreateReq
import com.sellerctrl.app.data.PayrollDetailDto
import kotlinx.coroutines.launch

/** First/last day of the current month, for the payroll period default. */
private fun monthBounds(): Pair<String, String> {
    val c = java.util.Calendar.getInstance()
    val y = c.get(java.util.Calendar.YEAR); val m = c.get(java.util.Calendar.MONTH) + 1
    val last = c.getActualMaximum(java.util.Calendar.DAY_OF_MONTH)
    return String.format("%04d-%02d-01", y, m) to String.format("%04d-%02d-%02d", y, m, last)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayrollFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    val (defFrom, defTo) = remember { monthBounds() }
    var periodStart by remember { mutableStateOf(defFrom) }
    var periodEnd by remember { mutableStateOf(defTo) }
    var paymentDate by remember { mutableStateOf(defTo) }
    var notes by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save() {
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.payrollCreate(PayrollCreateReq(periodStart, periodEnd, paymentDate.ifBlank { null }, notes.ifBlank { null })); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("مسيّر رواتب جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("يُبنى المسيّر تلقائيًا من كل الموظفين النشطين في الفترة.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            OutlinedTextField(periodStart, { periodStart = it }, label = { Text("بداية الفترة") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(periodEnd, { periodEnd = it }, label = { Text("نهاية الفترة") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(paymentDate, { paymentDate = it }, label = { Text("تاريخ الصرف") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(notes, { notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الإنشاء…" else "إنشاء المسيّر") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayrollDetailScreen(nav: NavController, id: String) {
    val scope = rememberCoroutineScope()
    var d by remember { mutableStateOf<PayrollDetailDto?>(null) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var reverseOpen by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { d = try { ServiceLocator.repo.payrollDetail(id) } catch (e: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("مسيّر رواتب") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val o = d
            if (o == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
            else Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(o.number, style = MaterialTheme.typography.titleLarge)
                        Text("${o.from} → ${o.to}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            AssistChip(onClick = {}, label = { Text(statusAr(o.status)) })
                            Column(horizontalAlignment = Alignment.End) {
                                Text("الصافي ${money(o.totalNet)}", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                Text("الإجمالي ${money(o.totalGross)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            }
                        }
                    }
                }
                Text("الموظفون (${o.lines.size})", style = MaterialTheme.typography.titleMedium)
                o.lines.forEach { l ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(l.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                Text(money(l.net), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                            }
                            Text("أساسي ${fmt(l.basic)} · بدلات ${fmt(l.allowances)} · خصومات ${fmt(l.deductions)} · ضريبة ${fmt(l.tax)}",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                }
                message?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
                if (o.status == "DRAFT") Button(onClick = {
                    busy = true; message = null
                    scope.launch { try { ServiceLocator.repo.postAction("api/v1/hr/payroll/$id/confirm"); message = "تم الترحيل ✓"; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
                }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "…" else "ترحيل المسيّر") }
                if (o.status == "POSTED") OutlinedButton(onClick = { reverseOpen = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("عكس المسيّر") }
            }
        }
    }

    if (reverseOpen) AlertDialog(
        onDismissRequest = { reverseOpen = false },
        title = { Text("عكس المسيّر") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("سيتم عكس قيد الرواتب. اكتب السبب:")
                OutlinedTextField(reason, { reason = it }, label = { Text("السبب *") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (reason.isBlank()) return@TextButton
                reverseOpen = false; busy = true; message = null
                scope.launch { try { ServiceLocator.repo.payrollReverse(id, reason.trim()); message = "تم العكس ✓"; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("عكس", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { reverseOpen = false }) { Text("إلغاء") } },
    )
}
