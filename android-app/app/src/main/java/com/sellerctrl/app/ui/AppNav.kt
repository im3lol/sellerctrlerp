package com.sellerctrl.app.ui

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
                    if (dest != route) nav.navigate(dest)
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
        composable("scan") { ScanScreen(nav) }
        composable("search") { SearchScreen(nav) }
        composable("item_form/{id}") { e -> ItemFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("transfers") { ListScreen(nav, "التحويلات المخزنية", "api/v1/inventory/transfers", detailPrefix = "transfer", addRoute = "transfer_form") }
        composable("transfer_form") { StockTransferFormScreen(nav) }
        composable("transfer/{id}") { e -> StockTransferDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("adjustments") { ListScreen(nav, "تسويات المخزون", "api/v1/inventory/adjustments", detailPrefix = "adjustment", addRoute = "adjustment_form") }
        composable("adjustment_form") { AdjustmentDocFormScreen(nav) }
        composable("adjustment/{id}") { e -> AdjustmentDocDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("bundles") { ListScreen(nav, "الحزم والمجموعات", "api/v1/inventory/bundles", detailPrefix = "bundle", addRoute = "bundle_form/new") }
        composable("bundle_form/{id}") { e -> BundleFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("bundle/{id}") { e -> BundleDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        // Inventory alert lists (reorder | dead-stock | expiry) — reuse the generic list.
        composable("alert/{key}") { e ->
            val key = e.arguments?.getString("key") ?: ""
            ListScreen(nav, ALERT_TITLES[key] ?: "تنبيه", "api/v1/alerts/$key")
        }
        composable("assets") { ListScreen(nav, "الأصول الثابتة", "api/v1/accounting/assets", detailPrefix = "asset", addRoute = "asset_form") }
        composable("asset_form") { AssetFormScreen(nav) }
        composable("asset/{id}") { e -> AssetDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("quotations") { ListScreen(nav, "عروض الأسعار", "api/v1/sales/quotations", detailPrefix = "quotation", addRoute = "quote_form") }
        composable("quote_form") { QuotationFormScreen(nav) }
        composable("quotation/{id}") { e -> QuotationDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("adjust") { AdjustmentScreen(nav) }
        // Module hubs
        composable("hub_sales") {
            HubScreen(nav, "المبيعات", listOf(
                "أوامر البيع" to "sales_orders",
                "فواتير البيع" to "sales_invoices",
                "أذون الصرف / التسليم" to "sales_deliveries",
            ))
        }
        composable("hub_purchases") {
            HubScreen(nav, "المشتريات", listOf(
                "أوامر الشراء" to "purchase_orders",
                "فواتير الشراء" to "purchase_invoices",
            ))
        }
        composable("hub_accounting") {
            HubScreen(nav, "المحاسبة", listOf(
                "القيود اليومية" to "journal",
                "المصروفات" to "expenses",
            ))
        }
        composable("hub_hr") {
            HubScreen(nav, "الموارد البشرية", listOf(
                "الموظفون" to "employees",
                "طلبات الإجازات" to "leaves",
                "مطالبات المصروفات" to "expense_claims",
            ))
        }
        composable("leaves") { ApprovalScreen(nav, "طلبات الإجازات", "api/v1/hr/leaves", "api/v1/hr/leaves", canReject = true, addRoute = "leave_form") }
        composable("leave_form") { LeaveFormScreen(nav) }
        composable("employee_form") { EmployeeFormScreen(nav, "new") }
        composable("employee/{id}") { e -> EmployeeFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("recurring") { ListScreen(nav, "الفواتير الدورية", "api/v1/sales/recurring", detailPrefix = "recurring_inv", addRoute = "recurring_form") }
        composable("recurring_form") { RecurringFormScreen(nav) }
        composable("recurring_inv/{id}") { e -> RecurringDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("expense_claims") { ApprovalScreen(nav, "مطالبات المصروفات", "api/v1/hr/expense-claims", "api/v1/hr/expense-claims", canReject = false) }
        // Lists
        composable("sales_orders") { ListScreen(nav, "أوامر البيع", "api/v1/sales/orders", detailPrefix = "sales_order", addRoute = "so_form") }
        composable("so_form") { SalesOrderFormScreen(nav) }
        composable("sales_order/{id}") { e ->
            val id = e.arguments?.getString("id") ?: ""
            DetailScreen(nav, "أمر بيع", "api/v1/sales/orders/$id", "api/v1/sales/orders/$id/confirm", "api/v1/sales/orders/$id/fulfill", deletePath = "api/v1/sales/orders/$id/delete")
        }
        composable("sales_invoices") { ListScreen(nav, "فواتير البيع", "api/v1/sales/invoices", detailPrefix = "sales_invoice", addRoute = "si_form") }
        composable("si_form") { SalesInvoiceFormScreen(nav) }
        composable("sales_invoice/{id}") { e -> SalesInvoiceDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("sales_deliveries") { ListScreen(nav, "التسليمات", "api/v1/sales/deliveries") }
        composable("purchase_orders") { ListScreen(nav, "أوامر الشراء", "api/v1/purchases/orders", detailPrefix = "purchase_order", addRoute = "po_form") }
        composable("po_form") { PurchaseOrderFormScreen(nav) }
        composable("purchase_order/{id}") { e ->
            val id = e.arguments?.getString("id") ?: ""
            DetailScreen(nav, "أمر شراء", "api/v1/purchases/orders/$id", "api/v1/purchases/orders/$id/confirm", deletePath = "api/v1/purchases/orders/$id/delete")
        }
        composable("purchase_receipts") { ListScreen(nav, "إذون الاستلام", "api/v1/purchases/receipts", detailPrefix = "purchase_receipt", addRoute = "receipt_form") }
        composable("receipt_form") { PurchaseReceiptFormScreen(nav) }
        composable("purchase_receipt/{id}") { e -> PurchaseReceiptDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("purchase_invoices") { ListScreen(nav, "فواتير الشراء", "api/v1/purchases/invoices", detailPrefix = "purchase_invoice", addRoute = "pi_form") }
        composable("pi_form") { PurchaseInvoiceFormScreen(nav) }
        composable("purchase_invoice/{id}") { e -> PurchaseInvoiceDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("customers") { ListScreen(nav, "العملاء", "api/v1/parties/customers") }
        composable("suppliers") { ListScreen(nav, "الموردون", "api/v1/parties/suppliers") }
        composable("journal") { ListScreen(nav, "القيود المحاسبية", "api/v1/accounting/journal", detailPrefix = "journal_entry", addRoute = "je_form") }
        composable("je_form") { JournalFormScreen(nav) }
        composable("journal_entry/{id}") { e -> JournalDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("expenses") { ListScreen(nav, "المصروفات", "api/v1/accounting/expenses", detailPrefix = "expense", addRoute = "expense_form") }
        composable("expense_form") { ExpenseFormScreen(nav) }
        composable("expense/{id}") { e -> ExpenseDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("banks_manager") { BankManagerScreen(nav) }
        composable("bank_form") { BankFormScreen(nav) }
        composable("recurring_journals") { ListScreen(nav, "القيود المتكررة", "api/v1/accounting/recurring-journals", detailPrefix = "recurring_je", addRoute = "recurring_je_form") }
        composable("recurring_je_form") { RecurringJournalFormScreen(nav) }
        composable("recurring_je/{id}") { e -> RecurringJournalDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("periods") { PeriodsScreen(nav) }
        composable("budget") { BudgetYearsScreen(nav) }
        composable("statement/{kind}") { e ->
            val kind = e.arguments?.getString("kind") ?: "account"
            StatementScreen(nav, STATEMENT_TITLES[kind] ?: "كشف حساب", kind)
        }
        composable("budget_year/{year}") { e -> BudgetYearScreen(nav, e.arguments?.getString("year") ?: "") }
        composable("aging/{kind}") { e ->
            val kind = e.arguments?.getString("kind") ?: "ar"
            AgingScreen(nav, if (kind == "ap") "أعمار ذمم الموردين" else "أعمار ذمم العملاء", kind)
        }
        composable("payroll") { ListScreen(nav, "مسيّرات الرواتب", "api/v1/hr/payroll", detailPrefix = "payroll_run", addRoute = "payroll_form") }
        composable("payroll_form") { PayrollFormScreen(nav) }
        composable("payroll_run/{id}") { e -> PayrollDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("recurring_expenses") { ListScreen(nav, "المصروفات الدورية", "api/v1/accounting/recurring-expenses", detailPrefix = "recurring_exp", addRoute = "recurring_exp_form") }
        composable("recurring_exp_form") { RecurringExpenseFormScreen(nav) }
        composable("recurring_exp/{id}") { e -> RecurringExpenseDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("bank_recon") { BankReconListScreen(nav) }
        composable("recon/{id}") { e -> BankReconScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("cost_centers") { ListScreen(nav, "مراكز التكلفة", "api/v1/accounting/cost-centers", detailPrefix = "cost_center", addRoute = "cost_center_form/new") }
        composable("cost_center_form/{id}") { e -> CostCenterFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("cost_center/{id}") { e -> CostCenterFormScreen(nav, e.arguments?.getString("id") ?: "new") }
        composable("employees") { ListScreen(nav, "الموظفون", "api/v1/hr/employees", detailPrefix = "employee", addRoute = "employee_form") }
        composable("investors") { ListScreen(nav, "المستثمرون", "api/v1/parties/investors") }
        composable("platforms") { ListScreen(nav, "منصات البيع", "api/v1/platforms") }
        composable("reports") { ReportsScreen(nav) }
        composable("requisitions") { ListScreen(nav, "طلبات المواد", "api/v1/list/requisitions", detailPrefix = "requisition", addRoute = "req_form") }
        composable("requisition/{id}") { e -> RequisitionDetailScreen(nav, e.arguments?.getString("id") ?: "") }
        composable("req_form") { RequisitionFormScreen(nav) }
        composable("suppliers_manager") { PartyManagerScreen(nav, "suppliers", "الموردون") }
        composable("customers_manager") { PartyManagerScreen(nav, "customers", "العملاء") }
        composable("party_form/{type}/{id}") { e ->
            PartyFormScreen(nav, e.arguments?.getString("type") ?: "suppliers", e.arguments?.getString("id") ?: "new")
        }
        composable("income_statement") { IncomeStatementScreen(nav) }
        composable("balance_sheet") { BalanceSheetScreen(nav) }
        composable("cash_flow") { CashFlowScreen(nav) }
        // Ranked sales/purchases reports.
        composable("report/{key}") { e ->
            val key = e.arguments?.getString("key") ?: ""
            ReportListScreen(nav, REPORT_TITLES[key] ?: "تقرير", key)
        }
        // Generic coverage-batch lists: one destination for every /api/v1/list/:key.
        composable("genlist/{key}") { e ->
            val key = e.arguments?.getString("key") ?: ""
            ListScreen(nav, GENLIST_TITLES[key] ?: "قائمة", "api/v1/list/$key")
        }
    }
}

/** Arabic titles for the statement kinds. */
private val STATEMENT_TITLES = mapOf(
    "account" to "دفتر الأستاذ",
    "customer" to "كشف حساب العميل",
    "supplier" to "كشف حساب المورّد",
)

/** Arabic titles for the inventory alert keys. */
private val ALERT_TITLES = mapOf(
    "reorder" to "تنبيهات إعادة الطلب",
    "dead-stock" to "المخزون الراكد",
    "expiry" to "تنبيهات انتهاء الصلاحية",
)

/** Arabic titles for the ranked report keys. */
private val REPORT_TITLES = mapOf(
    "sales-customers" to "المبيعات حسب العميل",
    "sales-items" to "المبيعات حسب الصنف",
    "purchases-suppliers" to "المشتريات حسب المورد",
    "purchases-items" to "المشتريات حسب الصنف",
)

/** Arabic titles for the generic list keys (mirror the web nav labels). */
private val GENLIST_TITLES = mapOf(
    "chart" to "دليل الحسابات",
    "sales-receipts" to "سندات القبض",
    "purchase-payments" to "سندات الصرف",
    "purchase-receipts" to "إذون الاستلام",
    "requisitions" to "طلبات المواد",
    "adjustments" to "تسويات المخزون",
    "transfers" to "التحويلات المخزنية",
    "banks" to "الحسابات البنكية",
    "assets" to "الأصول الثابتة",
    "quotations" to "عروض الأسعار",
    "holidays" to "تقويم العطلات",
    "stock-balances" to "أرصدة المخزون",
    "stock-ledger" to "دفتر حركة المخزون",
    "sales-ledger" to "تقرير دفتر المبيعات",
    "purchases-ledger" to "تقرير دفتر المشتريات",
)
