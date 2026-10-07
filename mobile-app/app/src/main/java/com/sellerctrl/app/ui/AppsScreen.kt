package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.CatalogItemDto
import com.sellerctrl.app.data.CatalogSectionDto
import kotlinx.coroutines.launch

/** Full app launcher sourced from the website's permission-filtered catalog. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppsScreen(nav: NavController) {
    var sections by remember { mutableStateOf<List<CatalogSectionDto>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    suspend fun refresh() {
        loading = true; failed = false
        runCatching { ServiceLocator.repo.catalog().sections }
            .onSuccess { sections = it }
            .onFailure { failed = true }
        loading = false
    }
    LaunchedEffect(Unit) { refresh() }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(tr("كل التطبيقات")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("رجوع")) } },
            actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, tr("تحديث")) } },
        )
    }) { pad ->
        when {
            loading -> CatalogLoading(Modifier.padding(pad))
            failed -> CatalogError(Modifier.padding(pad)) { scope.launch { refresh() } }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                sections.filter { it.items.isNotEmpty() }.forEach { section ->
                    item(key = section.heading ?: "home") { Text(section.heading ?: tr("الرئيسية"), style = MaterialTheme.typography.titleLarge) }
                    items(section.items, key = { it.href }) { item -> CatalogRow(item) {
                        val route = MobileRouteRegistry.routeFor(item.href)
                        if (route != null) nav.navigate(route)
                        else nav.navigate("parity/${Uri.encode(item.label)}")
                    } }
                }
            }
        }
    }
}

@Composable
private fun CatalogRow(item: CatalogItemDto, onClick: () -> Unit) {
    val native = MobileRouteRegistry.routeFor(item.href) != null
    AppCard(onClick = onClick, modifier = Modifier.fillMaxWidth(), border = null) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (native) Icons.Filled.GridView else Icons.Filled.ErrorOutline, null, tint = if (native) BrandBlue else Color(0xFFB45309))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(item.label, style = MaterialTheme.typography.titleSmall)
                item.group?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
                if (!native) Text(tr("قيد نقل تجربة الموبايل"), style = MaterialTheme.typography.labelSmall, color = Color(0xFFB45309))
            }
            Icon(Icons.Filled.ChevronLeft, null, tint = MaterialTheme.colorScheme.outline)
        }
    }
}

@Composable
private fun CatalogLoading(modifier: Modifier) {
    Column(modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(tr("جارٍ تجهيز تطبيقاتك…"), color = MaterialTheme.colorScheme.outline)
    }
}

@Composable
private fun CatalogError(modifier: Modifier, retry: () -> Unit) {
    Column(modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(Icons.Filled.ErrorOutline, null, tint = MaterialTheme.colorScheme.error)
        Text(tr("تعذّر تحميل التطبيقات"), style = MaterialTheme.typography.titleMedium)
        Text(tr("تحقّق من الاتصال ثم أعد المحاولة."), color = MaterialTheme.colorScheme.outline)
        IconButton(onClick = retry) { Icon(Icons.Filled.Refresh, tr("إعادة المحاولة")) }
    }
}

/** A single route map makes every mismatch auditable and prevents legacy labels. */
object MobileRouteRegistry {
    private val routes = mapOf(
        "/dashboard" to "home", "/platforms" to "platforms",
        "/approvals" to "approvals",
        "/accounting" to "hub_accounting", "/accounting/chart" to "genlist/chart",
        "/accounting/journal" to "journal", "/accounting/recurring-journals" to "recurring_journals",
        "/accounting/customer-statement" to "statement/customer", "/accounting/supplier-statement" to "statement/supplier",
        "/accounting/banks" to "banks_manager", "/accounting/reconciliation" to "bank_recon",
        "/accounting/expenses" to "expenses", "/accounting/assets" to "assets",
        "/accounting/aging" to "aging/ar", "/accounting/cost-centers" to "cost_centers",
        "/accounting/periods" to "periods", "/accounting/budget" to "budget",
        "/purchases" to "hub_purchases", "/purchases/requisitions" to "requisitions",
        "/purchases/orders" to "purchase_orders", "/purchases/receipts" to "purchase_receipts",
        "/purchases/invoices" to "purchase_invoices", "/purchases/suppliers" to "suppliers_manager",
        "/purchases/payments" to "genlist/purchase-payments", "/purchases/reports/ledger" to "genlist/purchases-ledger",
        "/inventory" to "search", "/inventory/items" to "search", "/inventory/adjustments" to "adjustments",
        "/inventory/warehouses" to "warehouses",
        "/inventory/cycle-count" to "cycle_counts",
        "/inventory/transfers" to "transfers", "/inventory/bundles" to "bundles",
        "/inventory/reorder" to "alert/reorder", "/inventory/dead-stock" to "alert/dead-stock",
        "/inventory/serials" to "genlist/serials", "/inventory/bins" to "genlist/bins",
        "/inventory/pick-lists" to "genlist/pick-lists", "/inventory/quality" to "genlist/quality",
        "/inventory/valuation" to "genlist/valuation",
        "/inventory/reconciliation" to "fba_reconciliation/amazon",
        "/inventory/expiry" to "alert/expiry", "/inventory/stock" to "genlist/stock-balances",
        "/inventory/ledger" to "genlist/stock-ledger", "/sales" to "hub_sales",
        "/sales/quotations" to "quotations", "/sales/orders" to "sales_orders",
        "/sales/deliveries" to "sales_deliveries", "/sales/invoices" to "sales_invoices",
        "/sales/receipts" to "genlist/sales-receipts", "/sales/recurring" to "recurring",
        "/sales/returns" to "genlist/sales-returns", "/sales/price-lists" to "genlist/price-lists",
        "/sales/promotions" to "genlist/promotions",
        "/purchases/rfqs" to "genlist/rfqs", "/purchases/landed-costs" to "genlist/landed-costs",
        "/sales/customers" to "customers_manager", "/sales/reports/ledger" to "genlist/sales-ledger",
        "/sales/reports/items" to "report/sales-items", "/sales/reports/customers" to "report/sales-customers",
        "/investors" to "investors", "/investors/list" to "investors", "/hr" to "hub_hr",
        "/hr/employees" to "employees", "/hr/leaves" to "leaves", "/hr/expense-claims" to "expense_claims",
        "/hr/payroll" to "payroll", "/hr/holidays" to "genlist/holidays", "/reports" to "reports", "/reports/center" to "reports",
        "/reports/income-statement" to "income_statement", "/reports/balance-sheet" to "balance_sheet", "/reports/cash-flow" to "cash_flow",
        "/sales/marketplace-returns" to "amazon_operations/amazon", "/sales/marketplace-removals" to "amazon_operations/amazon",
        "/sales/marketplace-reimbursements" to "amazon_operations/amazon", "/sales/orders/settlements" to "amazon_operations/amazon",
    )
    fun routeFor(href: String): String? = routes[href] ?: run {
        val parts = href.trimEnd('/').split('/').filter { it.isNotBlank() }
        if (parts.size == 3 && parts[0] == "platforms" && parts[2] == "health") "amazon_health/${parts[1]}"
        else if (parts.size == 2 && parts[0] == "platforms" && parts[1] == "amazon") "amazon_hub/amazon"
        else if (parts.size == 3 && parts[0] == "platforms" && parts[2] == "buy-box") "buy_box/${parts[1]}"
        else if (parts.size == 3 && parts[0] == "platforms" && parts[2] == "fba-plan") "fba_plan/${parts[1]}"
        else if (parts.size == 3 && parts[0] == "platforms" && parts[2] == "import") "amazon_sync/${parts[1]}"
        else if (parts.size == 3 && parts[0] == "platforms" && parts[2] in setOf("payouts", "fees", "statements", "verify", "reimbursements")) "amazon_operations/${parts[1]}"
        else null
    }
}
