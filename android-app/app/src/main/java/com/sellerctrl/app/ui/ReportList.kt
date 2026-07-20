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
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import com.sellerctrl.app.data.RankReportDto

/** Generic ranked report: total header + rows sorted by amount (customer/supplier/item). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportListScreen(nav: NavController, title: String, key: String) {
    var r by remember { mutableStateOf<RankReportDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(key, tick) {
        try { r = ServiceLocator.repo.rankReport(key) } catch (e: Exception) { error = "تعذّر التحميل"; r = RankReportDto("", "", 0.0, emptyList()) }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val rep = r
            when {
                rep == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                rep.rows.isEmpty() -> Text(error ?: "لا توجد بيانات في الفترة", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> Column(Modifier.fillMaxSize().padding(12.dp)) {
                    AppCard(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Column {
                                Text("الإجمالي", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
                                Text("${rep.from} → ${rep.to}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            }
                            Text(money(rep.total), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(rep.rows) { row ->
                            AppCard(Modifier.fillMaxWidth()) {
                                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(row.name, style = MaterialTheme.typography.titleSmall)
                                        val sub = if (row.count > 0) "${row.count} فاتورة" else "كمية: ${fmt(row.qty)}"
                                        Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                                    }
                                    Text(money(row.amount), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
