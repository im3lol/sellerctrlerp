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
        composable("home") { HomeScreen(nav) }
        composable("scan") { ScanScreen(nav) }
        composable("search") { SearchScreen(nav) }
    }
}
