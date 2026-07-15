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
        composable("sales_orders") { ListScreen(nav, "أوامر البيع", "api/v1/sales/orders") }
        composable("purchase_orders") { ListScreen(nav, "أوامر الشراء", "api/v1/purchases/orders") }
        composable("customers") { ListScreen(nav, "العملاء", "api/v1/parties/customers") }
        composable("suppliers") { ListScreen(nav, "الموردون", "api/v1/parties/suppliers") }
        composable("journal") { ListScreen(nav, "القيود المحاسبية", "api/v1/accounting/journal") }
        composable("employees") { ListScreen(nav, "الموظفون", "api/v1/hr/employees") }
    }
}
