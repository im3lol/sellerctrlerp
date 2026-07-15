package com.sellerctrl.app.ui

import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.sellerctrl.app.ServiceLocator

@Composable
fun AppNav() {
    val nav = rememberNavController()
    val start = if (ServiceLocator.repo.isLoggedIn()) "home" else "login"
    NavHost(navController = nav, startDestination = start) {
        composable("login") {
            LoginScreen(onDone = { nav.navigate("home") { popUpTo("login") { inclusive = true } } })
        }
        composable("home") { DashboardScreen(nav) }
        composable("scan") { ScanScreen(nav) }
        composable("search") { SearchScreen(nav) }
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
        // Lists
        composable("sales_orders") { ListScreen(nav, "أوامر البيع", "api/v1/sales/orders", detailPrefix = "sales_order") }
        composable("sales_order/{id}") { e ->
            val id = e.arguments?.getString("id") ?: ""
            DetailScreen(nav, "أمر بيع", "api/v1/sales/orders/$id", "api/v1/sales/orders/$id/confirm")
        }
        composable("sales_invoices") { ListScreen(nav, "فواتير البيع", "api/v1/sales/invoices") }
        composable("sales_deliveries") { ListScreen(nav, "التسليمات", "api/v1/sales/deliveries") }
        composable("purchase_orders") { ListScreen(nav, "أوامر الشراء", "api/v1/purchases/orders", detailPrefix = "purchase_order") }
        composable("purchase_order/{id}") { e ->
            val id = e.arguments?.getString("id") ?: ""
            DetailScreen(nav, "أمر شراء", "api/v1/purchases/orders/$id", "api/v1/purchases/orders/$id/confirm")
        }
        composable("purchase_invoices") { ListScreen(nav, "فواتير الشراء", "api/v1/purchases/invoices") }
        composable("customers") { ListScreen(nav, "العملاء", "api/v1/parties/customers") }
        composable("suppliers") { ListScreen(nav, "الموردون", "api/v1/parties/suppliers") }
        composable("journal") { ListScreen(nav, "القيود المحاسبية", "api/v1/accounting/journal") }
        composable("expenses") { ListScreen(nav, "المصروفات", "api/v1/accounting/expenses") }
        composable("employees") { ListScreen(nav, "الموظفون", "api/v1/hr/employees") }
        composable("investors") { ListScreen(nav, "المستثمرون", "api/v1/parties/investors") }
        composable("platforms") { ListScreen(nav, "منصات البيع", "api/v1/platforms") }
        composable("reports") { ReportsScreen(nav) }
    }
}
