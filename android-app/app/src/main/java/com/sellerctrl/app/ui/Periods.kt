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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.DocRow
import kotlinx.coroutines.launch

private val PERIOD_STATUSES = listOf("OPEN" to "مفتوحة", "SOFT_CLOSED" to "مغلقة مؤقتاً", "CLOSED" to "مقفلة")

/** Fiscal periods: list + change status (open / soft-close / close). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeriodsScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<DocRow>?>(null) }
    var pickFor by remember { mutableStateOf<DocRow?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(reload, tick) { rows = try { ServiceLocator.repo.docList("api/v1/accounting/periods") } catch (e: Exception) { emptyList() } }

    Scaffold(topBar = {
        TopAppBar(title = { Text("الفترات المالية") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val r = rows
            when {
                r == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                r.isEmpty() -> Text("لا توجد فترات مالية", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> Column(Modifier.fillMaxSize().padding(12.dp)) {
                    message?.let { Text(it, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 6.dp)) }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(r) { p ->
                            Card(Modifier.fillMaxWidth().clickable { pickFor = p }) {
                                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(p.title, style = MaterialTheme.typography.titleSmall)
                                        if (!p.subtitle.isNullOrBlank()) Text(p.subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                    }
                                    p.status?.let { AssistChip(onClick = {}, label = { Text(it) }) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    pickFor?.let { p ->
        AlertDialog(
            onDismissRequest = { pickFor = null },
            title = { Text(p.title) },
            text = {
                Column {
                    Text("غيّر حالة الفترة:", modifier = Modifier.padding(bottom = 8.dp))
                    PERIOD_STATUSES.forEach { (value, label) ->
                        Text(label, Modifier.fillMaxWidth().clickable {
                            pickFor = null
                            scope.launch { try { ServiceLocator.repo.periodStatus(p.id, value); message = "تم التحديث ✓"; reload++ } catch (e: Exception) { message = e.message ?: "خطأ" } }
                        }.padding(vertical = 12.dp), style = MaterialTheme.typography.bodyLarge)
                    }
                }
            },
            confirmButton = { OutlinedButton(onClick = { pickFor = null }) { Text("إلغاء") } },
        )
    }
}
