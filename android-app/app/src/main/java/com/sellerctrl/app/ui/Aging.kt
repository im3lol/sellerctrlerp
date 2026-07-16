package com.sellerctrl.app.ui

import androidx.compose.foundation.horizontalScroll
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
import com.sellerctrl.app.data.AgingReportDto

/** AR/AP aging: totals per bucket + a per-party breakdown. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgingScreen(nav: NavController, title: String, kind: String) {
    var r by remember { mutableStateOf<AgingReportDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val tick by ServiceLocator.repo.tick.collectAsState()
    LaunchedEffect(kind, tick) {
        try { r = ServiceLocator.repo.agingReport(kind) } catch (e: Exception) { error = "تعذّر التحميل"; r = AgingReportDto("") }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val rep = r
            when {
                rep == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                rep.rows.isEmpty() -> Text(error ?: "لا توجد أرصدة مستحقة", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> Column(Modifier.fillMaxSize().padding(12.dp)) {
                    Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Text("الإجمالي المستحق", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
                                Text(money(rep.grand), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                            }
                            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Bucket("جارٍ", rep.current); Bucket("١-٣٠", rep.d30); Bucket("٣١-٦٠", rep.d60); Bucket("٦١-٩٠", rep.d90); Bucket("+٩٠", rep.d90plus, warn = true)
                            }
                            Text("حتى ${rep.asOf}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(rep.rows.sortedByDescending { it.total }) { p ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text(p.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                        Text(money(p.total), fontWeight = FontWeight.SemiBold)
                                    }
                                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        if (p.current > 0) MiniBucket("جارٍ", p.current)
                                        if (p.d30 > 0) MiniBucket("١-٣٠", p.d30)
                                        if (p.d60 > 0) MiniBucket("٣١-٦٠", p.d60)
                                        if (p.d90 > 0) MiniBucket("٦١-٩٠", p.d90)
                                        if (p.d90plus > 0) MiniBucket("+٩٠", p.d90plus, warn = true)
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

@Composable
private fun Bucket(label: String, value: Double, warn: Boolean = false) {
    Column {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        Text(money(value), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
            color = if (warn && value > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun MiniBucket(label: String, value: Double, warn: Boolean = false) {
    Text("$label: ${fmt(value)}", style = MaterialTheme.typography.bodySmall,
        color = if (warn) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline)
}
