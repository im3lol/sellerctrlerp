package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
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
import com.sellerctrl.app.data.StmtLineDto

data class StmtSection(val title: String, val lines: List<StmtLineDto>, val subtotalLabel: String, val subtotal: Double)
data class StmtTotal(val label: String, val value: Double)

/** Generic financial-statement renderer: grouped account lines + a bold footer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatementScaffold(nav: NavController, title: String, subtitle: String?, load: suspend () -> Pair<List<StmtSection>, List<StmtTotal>>?) {
    val tick by ServiceLocator.repo.tick.collectAsState()
    var state by remember { mutableStateOf<Pair<List<StmtSection>, List<StmtTotal>>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(tick) {
        failed = false
        state = try { load() } catch (e: Exception) { failed = true; null }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            actions = { val open = LocalOpenDrawer.current; IconButton(onClick = open) { Icon(Icons.Filled.Menu, "القائمة") } },
        )
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            val s = state
            when {
                s == null && failed -> Text("تعذّر التحميل", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                s == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    subtitle?.let { item { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) } }
                    s.first.forEach { sec ->
                        item {
                            AppCard(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(sec.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                                    if (sec.lines.isEmpty()) Text("—", color = MaterialTheme.colorScheme.outline)
                                    sec.lines.forEach { l ->
                                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                            Text(l.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                            Text(money(l.amount), style = MaterialTheme.typography.bodyMedium)
                                        }
                                    }
                                    HorizontalDivider()
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text(sec.subtotalLabel, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                        Text(money(sec.subtotal), fontWeight = FontWeight.SemiBold)
                                    }
                                }
                            }
                        }
                    }
                    item {
                        AppCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                s.second.forEach { t ->
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                        Text(t.label, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                                        Text(money(t.value), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
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
fun IncomeStatementScreen(nav: NavController) {
    StatementScaffold(nav, "قائمة الدخل", null) {
        val d = ServiceLocator.repo.incomeStatement()
        listOf(
            StmtSection("الإيرادات", d.revenue, "إجمالي الإيرادات", d.totalRevenue),
            StmtSection("المصروفات", d.expense, "إجمالي المصروفات", d.totalExpense),
        ) to listOf(StmtTotal("صافي الربح", d.net))
    }
}

@Composable
fun BalanceSheetScreen(nav: NavController) {
    StatementScaffold(nav, "الميزانية العمومية", null) {
        val d = ServiceLocator.repo.balanceSheet()
        listOf(
            StmtSection("الأصول", d.assets, "إجمالي الأصول", d.totalAssets),
            StmtSection("الخصوم", d.liabilities, "إجمالي الخصوم", d.totalLiabilities),
            StmtSection("حقوق الملكية", d.equity, "إجمالي حقوق الملكية", d.totalEquity),
        ) to listOf(
            StmtTotal("الأصول", d.totalAssets),
            StmtTotal("الخصوم + حقوق الملكية", d.totalLiabilities + d.totalEquity),
        )
    }
}

@Composable
fun CashFlowScreen(nav: NavController) {
    StatementScaffold(nav, "التدفق النقدي", null) {
        val d = ServiceLocator.repo.cashFlow()
        listOf(
            StmtSection("الأنشطة التشغيلية", d.operating, "صافي التشغيل", d.opTotal),
            StmtSection("الأنشطة الاستثمارية", d.investing, "صافي الاستثمار", d.invTotal),
            StmtSection("الأنشطة التمويلية", d.financing, "صافي التمويل", d.finTotal),
        ) to listOf(
            StmtTotal("صافي التغيّر في النقدية", d.netChange),
            StmtTotal("نقدية أول المدة", d.cashBegin),
            StmtTotal("نقدية آخر المدة", d.cashEnd),
        )
    }
}
