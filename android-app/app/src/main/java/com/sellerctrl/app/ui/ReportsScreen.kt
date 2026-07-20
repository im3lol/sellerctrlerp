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
import androidx.compose.material.icons.filled.Menu
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
import com.sellerctrl.app.data.ReportsDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(nav: NavController) {
    var r by remember { mutableStateOf<ReportsDto?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        try { r = ServiceLocator.repo.reports() } catch (e: Exception) { failed = true }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("التقارير") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            actions = { val open = LocalOpenDrawer.current; IconButton(onClick = open) { Icon(Icons.Filled.Menu, "القائمة") } },
        )
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val d = r
            when {
                failed -> Text("لا تملك صلاحية عرض التقارير", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                d == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Section("قائمة الدخل") {
                        Line("الإيرادات", money(d.income))
                        Line("المصروفات", money(d.expense))
                        Line("صافي الربح", money(d.net), bold = true)
                    }
                    Section("الذمم") {
                        Line("ذمم مدينة (عملاء)", money(d.ar))
                        Line("ذمم دائنة (موردون)", money(d.ap))
                        Line("متأخرات مدينة", money(d.overdueAR))
                        Line("متأخرات دائنة", money(d.overdueAP))
                    }
                    Section("المخزون والتداول") {
                        Line("قيمة المخزون", money(d.inventoryValue))
                        Line("مبيعات الشهر", money(d.salesMonth))
                        Line("مشتريات الشهر", money(d.purchasesMonth))
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
    AppCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
private fun Line(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
    }
}
