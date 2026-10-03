package com.sellerctrl.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import kotlinx.coroutines.launch

/** Opens the compact drawer from any screen. The complete menu lives in AppsScreen. */
val LocalOpenDrawer = staticCompositionLocalOf<() -> Unit> { {} }

@Composable
fun SideNav(nav: NavController, current: String?, onNavigate: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxHeight().width(288.dp).background(BrandBlue).padding(16.dp)) {
        Text("sellerctrl", color = Color.White, fontSize = 25.sp)
        Text(ServiceLocator.repo.orgName(), color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
        Spacer(Modifier.height(24.dp))
        DrawerRow("الرئيسية", Icons.Filled.Home, current == "home") { onNavigate("home") }
        DrawerRow("كل التطبيقات", Icons.Filled.GridView, current == "apps") { onNavigate("apps") }
        DrawerRow("مسح باركود", Icons.Filled.QrCodeScanner, current == "scan") { onNavigate("scan") }
        Spacer(Modifier.weight(1f))
        DrawerRow("تسجيل الخروج", Icons.AutoMirrored.Filled.Logout, false) {
            scope.launch {
                ServiceLocator.repo.logout()
                onNavigate("login")
            }
        }
    }
}

@Composable
private fun DrawerRow(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, null, tint = if (selected) BrandYellow else Color.White, modifier = Modifier.size(20.dp))
        Text(label, color = if (selected) BrandYellow else Color.White)
    }
}
