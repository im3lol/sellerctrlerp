package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Store
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.DashboardDto
import kotlinx.coroutines.launch

private data class Mod(val label: String, val icon: ImageVector, val route: String)

private val MODULES = listOf(
    Mod("المخزون", Icons.Filled.Inventory2, "search"),
    Mod("جرد المخزون", Icons.Filled.Checklist, "adjust"),
    Mod("مسح باركود", Icons.Filled.QrCodeScanner, "scan"),
    Mod("المبيعات", Icons.Filled.ShoppingCart, "hub_sales"),
    Mod("المشتريات", Icons.AutoMirrored.Filled.List, "hub_purchases"),
    Mod("العملاء", Icons.Filled.People, "customers"),
    Mod("الموردون", Icons.Filled.Store, "suppliers"),
    Mod("المحاسبة", Icons.Filled.AccountBalance, "hub_accounting"),
    Mod("الموارد البشرية", Icons.Filled.Badge, "hub_hr"),
    Mod("التقارير", Icons.Filled.Assessment, "reports"),
    Mod("المستثمرون", Icons.Filled.Savings, "investors"),
    Mod("المنصات", Icons.Filled.Storefront, "platforms"),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(nav: NavController) {
    val repo = ServiceLocator.repo
    val scope = rememberCoroutineScope()
    var dash by remember { mutableStateOf<DashboardDto?>(null) }
    val tick by repo.tick.collectAsState()
    LaunchedEffect(tick) { dash = try { repo.dashboard() } catch (_: Exception) { null } }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("SellerCtrl", color = BrandBlue, fontWeight = FontWeight.Black) },
            navigationIcon = {
                val open = LocalOpenDrawer.current
                IconButton(onClick = open) { Icon(Icons.Filled.Menu, "القائمة", tint = BrandBlue) }
            },
            actions = {
                IconButton(onClick = { scope.launch { repo.logout(); nav.navigate("login") { popUpTo(0) } } }) {
                    Icon(Icons.AutoMirrored.Filled.Logout, "خروج")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
        )
    }) { pad ->
        LazyColumn(
            Modifier.fillMaxSize().padding(pad).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column {
                    Text("مرحبًا، ${repo.userName()}", style = MaterialTheme.typography.titleLarge)
                    if (repo.orgName().isNotEmpty()) Text(repo.orgName(), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline)
                }
            }
            dash?.let { d ->
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Stat("صافي الربح", money(d.net), Modifier.weight(1f))
                            Stat("النقدية والبنك", money(d.cash), Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Stat("ذمم العملاء", money(d.ar), Modifier.weight(1f))
                            Stat("قيمة المخزون", money(d.inventoryValue), Modifier.weight(1f))
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Stat("مبيعات الشهر", money(d.salesMonth), Modifier.weight(1f))
                            Stat("نواقص المخزون", "${d.lowStock + d.outOfStock}", Modifier.weight(1f))
                        }
                    }
                }
            }
            item { Text("الوحدات", style = MaterialTheme.typography.titleMedium) }
            MODULES.chunked(3).forEach { rowMods ->
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        rowMods.forEach { m -> ModuleTile(m, Modifier.weight(1f)) { nav.navigate(m.route) } }
                        repeat(3 - rowMods.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier = Modifier) {
    AppCard(modifier) {
        Column(Modifier.padding(12.dp)) {
            Text(value, style = MaterialTheme.typography.titleMedium)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
private fun ModuleTile(m: Mod, modifier: Modifier = Modifier, onClick: () -> Unit) {
    AppCard(onClick = onClick, modifier = modifier.height(96.dp), container = MaterialTheme.colorScheme.primaryContainer, border = null) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(m.icon, null, tint = BrandBlue)
            Spacer(Modifier.height(6.dp))
            Text(m.label, style = MaterialTheme.typography.labelMedium, color = BrandBlue)
        }
    }
}
