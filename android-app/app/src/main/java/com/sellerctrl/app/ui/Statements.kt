package com.sellerctrl.app.ui

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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.DocRow
import com.sellerctrl.app.data.StatementDto

/**
 * Shared statement screen: pick a subject (account / customer / supplier), then show
 * its opening balance, movements and a running balance — same engine as the web.
 *
 * kind: "account" (دفتر الأستاذ) | "customer" | "supplier"
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatementScreen(nav: NavController, title: String, kind: String) {
    val subjectPath = when (kind) {
        "customer" -> "api/v1/parties/customers"
        "supplier" -> "api/v1/parties/suppliers"
        else -> "api/v1/accounting/accounts"   // leaf accounts hold the entries
    }
    val subjectLabel = when (kind) {
        "customer" -> "اختر العميل"
        "supplier" -> "اختر المورّد"
        else -> "اختر الحساب"
    }

    var subjects by remember { mutableStateOf<List<DocRow>>(emptyList()) }
    var picker by remember { mutableStateOf(false) }
    var id by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var st by remember { mutableStateOf<StatementDto?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val tick by ServiceLocator.repo.tick.collectAsState()

    LaunchedEffect(Unit) { subjects = try { ServiceLocator.repo.docList(subjectPath) } catch (e: Exception) { emptyList() } }
    LaunchedEffect(id, tick) {
        if (id.isBlank()) return@LaunchedEffect
        loading = true; error = null
        st = try { ServiceLocator.repo.statement(kind, id) } catch (e: Exception) { error = "تعذّر التحميل"; null }
        loading = false
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).padding(12.dp)) {
            OutlinedButton(onClick = { picker = true }, modifier = Modifier.fillMaxWidth()) {
                Text(if (name.isBlank()) "$subjectLabel *" else name, maxLines = 1)
            }
            Box(Modifier.fillMaxSize()) {
                val s = st
                when {
                    id.isBlank() -> Text("اختر لعرض الكشف", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                    loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    s == null -> Text(error ?: "لا توجد بيانات", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                    else -> Column(Modifier.fillMaxSize().padding(top = 10.dp)) {
                        AppCard(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(s.title, style = MaterialTheme.typography.titleSmall)
                                Text("${s.from} → ${s.to}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("رصيد افتتاحي ${money(s.opening)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                    Text("مدين ${fmt(s.totalDebit)} · دائن ${fmt(s.totalCredit)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text("الرصيد الختامي", fontWeight = FontWeight.Bold)
                                    Text(money(s.closing), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                        if (s.rows.isEmpty()) Text("لا توجد حركات في الفترة", Modifier.padding(top = 16.dp), color = MaterialTheme.colorScheme.outline)
                        else LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            items(s.rows) { r ->
                                AppCard(Modifier.fillMaxWidth()) {
                                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text(r.description, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                            Text(money(r.balance), fontWeight = FontWeight.SemiBold)
                                        }
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text(r.date, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                            Text(
                                                if (r.debit > 0) "مدين ${fmt(r.debit)}" else "دائن ${fmt(r.credit)}",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = if (r.debit > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (picker) AccountPickerDialog(subjectLabel, subjects, onDismiss = { picker = false }) { s ->
        id = s.id; name = if (s.number.isBlank()) s.title else "${s.number} ${s.title}"; picker = false
    }
}
