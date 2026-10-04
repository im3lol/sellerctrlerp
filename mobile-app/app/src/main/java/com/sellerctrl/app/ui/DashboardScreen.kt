package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Store
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.R
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.DashboardDto

private data class MobileModule(val label: String, val icon: ImageVector, val route: String, val tint: Color)

private val mobileModules = listOf(
    MobileModule(tr("المخزون"), Icons.Filled.Inventory2, "search", Color(0xFF0E9F8A)),
    MobileModule(tr("المبيعات"), Icons.Filled.ShoppingCart, "hub_sales", Color(0xFF1946D8)),
    MobileModule(tr("المشتريات"), Icons.Filled.Store, "hub_purchases", Color(0xFFF07B00)),
    MobileModule(tr("المحاسبة"), Icons.Filled.AccountBalance, "hub_accounting", Color(0xFF1687D4)),
    MobileModule(tr("العملاء"), Icons.Filled.People, "customers", Color(0xFF8B5CF6)),
    MobileModule(tr("التقارير"), Icons.Filled.Assessment, "reports", Color(0xFF5D47EA)),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(nav: NavController) {
    val repo = ServiceLocator.repo
    var dashboard by remember { mutableStateOf<DashboardDto?>(null) }
    val tick by repo.tick.collectAsState()
    LaunchedEffect(tick) { dashboard = runCatching { repo.dashboard() }.getOrNull() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(tr("مرحبًا، ${repo.userName()}"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        if (repo.orgName().isNotBlank()) Text(repo.orgName(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                    }
                },
                navigationIcon = { IconButton(onClick = LocalOpenDrawer.current) { Icon(Icons.Filled.Menu, tr("كل الأقسام"), tint = BrandBlue) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White),
            )
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White) {
                NavigationBarItem(selected = true, onClick = { nav.navigate("home") }, icon = { Icon(Icons.Filled.Inventory2, null) }, label = { Text(tr("الرئيسية")) })
                NavigationBarItem(selected = false, onClick = { nav.navigate("search") }, icon = { Icon(Icons.Filled.Search, null) }, label = { Text(tr("الأصناف")) })
                NavigationBarItem(selected = false, onClick = { nav.navigate("scan") }, icon = { Icon(Icons.Filled.QrCodeScanner, null) }, label = { Text(tr("مسح")) })
                NavigationBarItem(selected = false, onClick = { nav.navigate("apps") }, icon = { Icon(Icons.Filled.Menu, null) }, label = { Text(tr("المزيد")) })
            }
        },
    ) { pad ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(pad).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { WelcomeCard() }
            dashboard?.let { dash ->
                item { KpiGrid(dash) }
                if (dash.lowStock + dash.outOfStock > 0 || dash.pending.soAwaiting + dash.pending.poAwaiting > 0) {
                    item { AttentionCard(dash) { nav.navigate("alert/reorder") } }
                }
            }
            item { Text(tr("إجراءات سريعة"), style = MaterialTheme.typography.titleLarge) }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    QuickAction(tr("مسح باركود"), Icons.Filled.QrCodeScanner, Modifier.weight(1f)) { nav.navigate("scan") }
                    QuickAction(tr("أمر بيع"), Icons.Filled.ShoppingCart, Modifier.weight(1f)) { nav.navigate("sales_orders") }
                    QuickAction(tr("تجديد المخزون"), Icons.Filled.Inventory2, Modifier.weight(1f)) { nav.navigate("alert/reorder") }
                }
            }
            item { Text(tr("الأقسام"), style = MaterialTheme.typography.titleLarge) }
            mobileModules.chunked(2).forEach { row ->
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        row.forEach { module -> ModuleCard(module, Modifier.weight(1f)) { nav.navigate(module.route) } }
                        if (row.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
            item { Spacer(Modifier.height(8.dp)) }
        }
    }
}

@Composable
private fun WelcomeCard() {
    Card(colors = CardDefaults.cardColors(containerColor = BrandBlue), shape = MaterialTheme.shapes.large) {
        Row(Modifier.fillMaxWidth().height(150.dp).padding(start = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(tr("كل عملياتك تحت السيطرة"), color = Color.White, style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(6.dp))
                Text(tr("تابع المبيعات والمخزون والتنبيهات لحظيًا."), color = Color.White.copy(alpha = 0.78f), style = MaterialTheme.typography.bodySmall)
            }
            Image(painterResource(R.drawable.mascot_welcome), "Mascot", Modifier.width(140.dp).height(140.dp))
        }
    }
}

@Composable
private fun KpiGrid(d: DashboardDto) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Kpi(tr("مبيعات الشهر"), money(d.salesMonth), Modifier.weight(1f), BrandBlue)
            Kpi(tr("قيمة المخزون"), money(d.inventoryValue), Modifier.weight(1f), Color(0xFF0E9F8A))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Kpi(tr("صافي الربح"), money(d.net), Modifier.weight(1f), Color(0xFF5D47EA))
            Kpi(tr("النقدية والبنك"), money(d.cash), Modifier.weight(1f), Color(0xFFF07B00))
        }
    }
}

@Composable
private fun Kpi(label: String, value: String, modifier: Modifier, accent: Color) {
    Card(modifier, colors = CardDefaults.cardColors(containerColor = Color.White), elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)) {
        Column(Modifier.padding(14.dp)) {
            Box(Modifier.size(5.dp).clip(MaterialTheme.shapes.extraSmall).background(accent))
            Spacer(Modifier.height(10.dp))
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
private fun AttentionCard(d: DashboardDto, onClick: () -> Unit) {
    AppCard(onClick = onClick, container = Color(0xFFFFF7E4), border = null) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.WarningAmber, null, tint = Color(0xFFB45309))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(tr("تحتاج متابعة"), style = MaterialTheme.typography.titleSmall)
                Text(tr("${d.lowStock + d.outOfStock} أصناف تحتاج تجديدًا"), style = MaterialTheme.typography.bodySmall, color = Color(0xFF92400E))
            }
        }
    }
}

@Composable
private fun QuickAction(label: String, icon: ImageVector, modifier: Modifier, onClick: () -> Unit) {
    AppCard(onClick = onClick, modifier = modifier, container = Color(0xFFF4F6FF), border = null) {
        Column(Modifier.padding(vertical = 14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = BrandBlue)
            Spacer(Modifier.height(6.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, color = BrandBlue)
        }
    }
}

@Composable
private fun ModuleCard(module: MobileModule, modifier: Modifier, onClick: () -> Unit) {
    AppCard(onClick = onClick, modifier = modifier.height(106.dp), border = null) {
        Row(Modifier.fillMaxSize().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).clip(MaterialTheme.shapes.medium).background(module.tint.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                Icon(module.icon, null, tint = module.tint)
            }
            Spacer(Modifier.width(10.dp))
            Text(module.label, style = MaterialTheme.typography.titleSmall)
        }
    }
}
