package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.sellerctrl.app.ServiceLocator
import kotlinx.coroutines.launch

@Composable
fun AppNav() {
    val nav = rememberNavController()
    val start = if (ServiceLocator.repo.isLoggedIn()) "home" else "login"
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    androidx.compose.runtime.LaunchedEffect(Unit) { ServiceLocator.repo.startRealtime() }
    val current by nav.currentBackStackEntryAsState()
    val route = current?.destination?.route
    // Drawer is available on the workspace; never on the login screen.
    val gesturesEnabled = drawerState.isOpen || (route != null && route != "login")

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = gesturesEnabled,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = androidx.compose.ui.graphics.Color(0xFF0A33D1)) {
                SideNav(nav, route) { dest ->
                    scope.launch { drawerState.close() }
                    if (dest == "login") {
                        // A logout must discard every authenticated destination. Otherwise
                        // Android Back could reveal a cached ERP screen after the session is cleared.
                        nav.navigate("login") { popUpTo(0) { inclusive = true } }
                    } else if (dest != route) {
                        nav.navigate(dest)
                    }
                }
            }
        },
    ) {
        CompositionLocalProvider(LocalOpenDrawer provides { scope.launch { drawerState.open() } }) {
            AppNavHost(nav, start)
        }
    }
}

@Composable
private fun AppNavHost(nav: androidx.navigation.NavHostController, start: String) {
    NavHost(navController = nav, startDestination = start) {
        composable("login") {
            LoginScreen(onDone = { nav.navigate("home") { popUpTo("login") { inclusive = true } } })
        }
        composable("home") { DashboardScreen(nav) }
        composable("apps") { AppsScreen(nav) }
        composable("approvals") { ApprovalInboxScreen(nav) }
        composable("parity/{label}") { entry -> ParityScreen(nav, entry.arguments?.getString("label") ?: "") }
        composable("amazon_hub/{code}") { entry -> AmazonHubScreen(nav, entry.arguments?.getString("code") ?: "amazon") }
        composable("amazon_health/{code}") { entry -> AmazonHealthScreen(nav, entry.arguments?.getString("code") ?: "amazon") }
        composable("amazon_operations/{code}") { entry -> AmazonOperationsScreen(nav, entry.arguments?.getString("code") ?: "amazon") }
        composable("buy_box/{code}") { entry -> BuyBoxScreen(nav, entry.arguments?.getString("code") ?: "amazon") }
        composable("fba_plan/{code}") { entry -> FbaPlanScreen(nav, entry.arguments?.getString("code") ?: "amazon") }
        composable("fba_reconciliation/{code}") { entry -> FbaReconciliationScreen(nav, entry.arguments?.getString("code") ?: "amazon") }
        composable("amazon_sync/{code}") { entry -> AmazonSyncScreen(nav, entry.arguments?.getString("code") ?: "amazon") }
        composable("scan") { ScanScreen(nav) }
        composable("warehouses") { WarehousesScreen(nav) }
        composable("cycle_counts") { CycleCountsScreen(nav) }
        composable("cycle_count/{id}") { e -> CycleCountDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("search") { SearchScreen(nav) }
        composable("item_form/{id}") { e -> ItemFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("transfers") { ListScreen(nav, tr("التحويلات المخزنية"), "api/v1/inventory/transfers", detailPrefix = "transfer", addRoute = "transfer_form") }
        composable("transfer_form") { StockTransferFormScreen(nav) }
        composable("transfer/{id}") { e -> StockTransferDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("adjustments") { ListScreen(nav, tr("تسويات المخزون"), "api/v1/inventory/adjustments", detailPrefix = "adjustment", addRoute = "adjustment_form") }
        composable("adjustment_form") { AdjustmentDocFormScreen(nav) }
        composable("adjustment/{id}") { e -> AdjustmentDocDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("bundles") { ListScreen(nav, tr("الحزم والمجموعات"), "api/v1/inventory/bundles", detailPrefix = "bundle", addRoute = "bundle_form/new") }
        composable("bundle_form/{id}") { e -> BundleFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("bundle/{id}") { e -> BundleDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        // Inventory alert lists (reorder | dead-stock | expiry) — reuse the generic list.
        composable("alert/{key}") { e ->
            val key = e.arguments?.getString("key") ?: ""
            ListScreen(nav, ALERT_TITLES[key] ?: tr("تنبيه"), "api/v1/alerts/$key")
        }
        composable("assets") { ListScreen(nav, tr("الأصول الثابتة"), "api/v1/accounting/assets", detailPrefix = "asset", addRoute = "asset_form") }
        composable("asset_form") { AssetFormScreen(nav) }
        composable("asset/{id}") { e -> AssetDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("quotations") { ListScreen(nav, tr("عروض الأسعار"), "api/v1/sales/quotations", detailPrefix = "quotation", addRoute = "quote_form") }
        composable("quote_form") { QuotationFormScreen(nav) }
        composable("quotation/{id}") { e -> QuotationDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("adjust") { AdjustmentScreen(nav) }
        // Module hubs
        composable("hub_sales") {
            HubScreen(nav, tr("المبيعات"), listOf(
                tr("أوامر البيع") to "sales_orders",
                tr("فواتير البيع") to "sales_invoices",
                tr("أذون الصرف / التسليم") to "sales_deliveries",
            ))
        }
        composable("hub_purchases") {
            HubScreen(nav, tr("المشتريات"), listOf(
                tr("أوامر الشراء") to "purchase_orders",
                tr("فواتير الشراء") to "purchase_invoices",
            ))
        }
        composable("hub_accounting") {
            HubScreen(nav, tr("المحاسبة"), listOf(
                tr("القيود اليومية") to "journal",
                tr("المصروفات") to "expenses",
            ))
        }
        composable("hub_hr") {
            HubScreen(nav, tr("الموارد البشرية"), listOf(
                tr("الموظفون") to "employees",
                tr("طلبات الإجازات") to "leaves",
                tr("مطالبات المصروفات") to "expense_claims",
            ))
        }
        composable("leaves") { ApprovalScreen(nav, tr("طلبات الإجازات"), "api/v1/hr/leaves", "api/v1/hr/leaves", canReject = true, addRoute = "leave_form") }
        composable("leave_form") { LeaveFormScreen(nav) }
        composable("employee_form") { EmployeeFormScreen(nav, "new") }
        composable("employee/{id}") { e -> EmployeeFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("recurring") { ListScreen(nav, tr("الفواتير الدورية"), "api/v1/sales/recurring", detailPrefix = "recurring_inv", addRoute = "recurring_form") }
        composable("recurring_form") { RecurringFormScreen(nav) }
        composable("recurring_inv/{id}") { e -> RecurringDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("expense_claims") { ApprovalScreen(nav, tr("مطالبات المصروفات"), "api/v1/hr/expense-claims", "api/v1/hr/expense-claims", canReject = false) }
        // Lists
        composable("sales_orders") { ListScreen(nav, tr("أوامر البيع"), "api/v1/sales/orders", detailPrefix = "sales_order", addRoute = "so_form") }
        composable("so_form") { SalesOrderFormScreen(nav) }
        composable("sales_order/{id}") { e ->
            val id = e.arguments?.getString("id") ?: ""
            DetailScreen(nav, tr("أمر بيع"), "api/v1/sales/orders/$id", "api/v1/sales/orders/$id/confirm", "api/v1/sales/orders/$id/fulfill", deletePath = "api/v1/sales/orders/$id/delete")
        }
        composable("sales_invoices") { ListScreen(nav, tr("فواتير البيع"), "api/v1/sales/invoices", detailPrefix = "sales_invoice", addRoute = "si_form") }
        composable("si_form") { SalesInvoiceFormScreen(nav) }
        composable("sales_invoice/{id}") { e -> SalesInvoiceDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("sales_deliveries") { ListScreen(nav, tr("التسليمات"), "api/v1/sales/deliveries") }
        composable("purchase_orders") { ListScreen(nav, tr("أوامر الشراء"), "api/v1/purchases/orders", detailPrefix = "purchase_order", addRoute = "po_form") }
        composable("po_form") { PurchaseOrderFormScreen(nav) }
        composable("purchase_order/{id}") { e ->
            val id = e.arguments?.getString("id") ?: ""
            DetailScreen(nav, tr("أمر شراء"), "api/v1/purchases/orders/$id", "api/v1/purchases/orders/$id/confirm", deletePath = "api/v1/purchases/orders/$id/delete")
        }
        composable("purchase_receipts") { ListScreen(nav, tr("إذون الاستلام"), "api/v1/purchases/receipts", detailPrefix = "purchase_receipt", addRoute = "receipt_form") }
        composable("receipt_form") { PurchaseReceiptFormScreen(nav) }
        composable("purchase_receipt/{id}") { e -> PurchaseReceiptDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("purchase_invoices") { ListScreen(nav, tr("فواتير الشراء"), "api/v1/purchases/invoices", detailPrefix = "purchase_invoice", addRoute = "pi_form") }
        composable("pi_form") { PurchaseInvoiceFormScreen(nav) }
        composable("purchase_invoice/{id}") { e -> PurchaseInvoiceDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("customers") { ListScreen(nav, tr("العملاء"), "api/v1/parties/customers") }
        composable("suppliers") { ListScreen(nav, tr("الموردون"), "api/v1/parties/suppliers") }
        composable("journal") { ListScreen(nav, tr("القيود المحاسبية"), "api/v1/accounting/journal", detailPrefix = "journal_entry", addRoute = "je_form") }
        composable("je_form") { JournalFormScreen(nav) }
        composable("journal_entry/{id}") { e -> JournalDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("expenses") { ListScreen(nav, tr("المصروفات"), "api/v1/accounting/expenses", detailPrefix = "expense", addRoute = "expense_form") }
        composable("expense_form") { ExpenseFormScreen(nav) }
        composable("expense/{id}") { e -> ExpenseDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("banks_manager") { BankManagerScreen(nav) }
        composable("bank_form") { BankFormScreen(nav) }
        composable("recurring_journals") { ListScreen(nav, tr("القيود المتكررة"), "api/v1/accounting/recurring-journals", detailPrefix = "recurring_je", addRoute = "recurring_je_form") }
        composable("recurring_je_form") { RecurringJournalFormScreen(nav) }
        composable("recurring_je/{id}") { e -> RecurringJournalDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("periods") { PeriodsScreen(nav) }
        composable("budget") { BudgetYearsScreen(nav) }
        composable("statement/{kind}") { e ->
            val kind = e.arguments?.getString("kind") ?: "account"
            StatementScreen(nav, STATEMENT_TITLES[kind] ?: tr("كشف حساب"), kind)
        }
        composable("budget_year/{year}") { e -> BudgetYearScreen(nav, e.arguments?.getString("year") ?: "") }
        composable("aging/{kind}") { e ->
            val kind = e.arguments?.getString("kind") ?: "ar"
            AgingScreen(nav, if (kind == "ap") tr("أعمار ذمم الموردين") else tr("أعمار ذمم العملاء"), kind)
        }
        composable("payroll") { ListScreen(nav, tr("مسيّرات الرواتب"), "api/v1/hr/payroll", detailPrefix = "payroll_run", addRoute = "payroll_form") }
        composable("payroll_form") { PayrollFormScreen(nav) }
        composable("payroll_run/{id}") { e -> PayrollDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("recurring_expenses") { ListScreen(nav, tr("المصروفات الدورية"), "api/v1/accounting/recurring-expenses", detailPrefix = "recurring_exp", addRoute = "recurring_exp_form") }
        composable("recurring_exp_form") { RecurringExpenseFormScreen(nav) }
        composable("recurring_exp/{id}") { e -> RecurringExpenseDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("bank_recon") { BankReconListScreen(nav) }
        composable("recon/{id}") { e -> BankReconScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("cost_centers") { ListScreen(nav, tr("مراكز التكلفة"), "api/v1/accounting/cost-centers", detailPrefix = "cost_center", addRoute = "cost_center_form/new") }
        composable("cost_center_form/{id}") { e -> CostCenterFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("cost_center/{id}") { e -> CostCenterFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("employees") { ListScreen(nav, tr("الموظفون"), "api/v1/hr/employees", detailPrefix = "employee", addRoute = "employee_form") }
        composable("investors") { ListScreen(nav, tr("المستثمرون"), "api/v1/parties/investors") }
        composable("platforms") { ListScreen(nav, tr("منصات البيع"), "api/v1/platforms") }
        composable("reports") { ReportsScreen(nav) }
        composable("requisitions") { ListScreen(nav, tr("طلبات المواد"), "api/v1/list/requisitions", detailPrefix = "requisition", addRoute = "req_form") }
        composable("requisition/{id}") { e -> RequisitionDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("req_form") { RequisitionFormScreen(nav) }
        composable("suppliers_manager") { PartyManagerScreen(nav, "suppliers", tr("الموردون")) }
        composable("customers_manager") { PartyManagerScreen(nav, "customers", tr("العملاء")) }
        composable("party_form/{type}/{id}") { e ->
            PartyFormScreen(nav, e.arguments?.getString("type") ?: "suppliers", e.arguments?.getString("id") ?: "new")
        }
        composable("income_statement") { IncomeStatementScreen(nav) }
        composable("balance_sheet") { BalanceSheetScreen(nav) }
        composable("cash_flow") { CashFlowScreen(nav) }
        // Ranked sales/purchases reports.
        composable("report/{key}") { e ->
            val key = e.arguments?.getString("key") ?: ""
            ReportListScreen(nav, REPORT_TITLES[key] ?: tr("تقرير"), key)
        }
        // Generic coverage-batch lists: one destination for every /api/v1/list/:key.
        composable("genlist/{key}") { e ->
            val key = e.arguments?.getString("key") ?: ""
            ListScreen(nav, GENLIST_TITLES[key] ?: tr("قائمة"), "api/v1/list/$key")
        }
    }
}

/** Arabic titles for the statement kinds. */
private val STATEMENT_TITLES = mapOf(
    "account" to tr("دفتر الأستاذ"),
    "customer" to tr("كشف حساب العميل"),
    "supplier" to tr("كشف حساب المورّد"),
)

/** Arabic titles for the inventory alert keys. */
private val ALERT_TITLES = mapOf(
    "reorder" to tr("تنبيهات إعادة الطلب"),
    "dead-stock" to tr("المخزون الراكد"),
    "expiry" to tr("تنبيهات انتهاء الصلاحية"),
)

/** Arabic titles for the ranked report keys. */
private val REPORT_TITLES = mapOf(
    "sales-customers" to tr("المبيعات حسب العميل"),
    "sales-items" to tr("المبيعات حسب الصنف"),
    "purchases-suppliers" to tr("المشتريات حسب المورد"),
    "purchases-items" to tr("المشتريات حسب الصنف"),
)

/** Arabic titles for the generic list keys (mirror the web nav labels). */
private val GENLIST_TITLES = mapOf(
    "chart" to tr("دليل الحسابات"),
    "sales-receipts" to tr("سندات القبض"),
    "purchase-payments" to tr("سندات الصرف"),
    "purchase-receipts" to tr("إذون الاستلام"),
    "requisitions" to tr("طلبات المواد"),
    "adjustments" to tr("تسويات المخزون"),
    "transfers" to tr("التحويلات المخزنية"),
    "banks" to tr("الحسابات البنكية"),
    "assets" to tr("الأصول الثابتة"),
    "quotations" to tr("عروض الأسعار"),
    "holidays" to tr("تقويم العطلات"),
    "stock-balances" to tr("أرصدة المخزون"),
    "stock-ledger" to tr("دفتر حركة المخزون"),
    "sales-ledger" to tr("تقرير دفتر المبيعات"),
    "purchases-ledger" to tr("تقرير دفتر المشتريات"),
    "serials" to tr("الأرقام التسلسلية"),
    "bins" to tr("مواقع التخزين"),
    "pick-lists" to tr("جولات التجهيز"),
    "quality" to tr("فحص الجودة"),
    "valuation" to tr("تقييم المخزون"),
    "sales-returns" to tr("مرتجعات المبيعات"),
    "price-lists" to tr("قوائم الأسعار"),
    "promotions" to tr("العروض ونقط الولاء"),
    "rfqs" to tr("طلبات عروض الأسعار"),
    "landed-costs" to tr("تكاليف الاستيراد"),
)
