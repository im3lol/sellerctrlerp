package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(nav: NavController) {
    val repo = ServiceLocator.repo
    val scope = rememberCoroutineScope()
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("مرحبًا، ${repo.userName()}", style = MaterialTheme.typography.headlineSmall)
        if (repo.orgName().isNotEmpty()) Text(repo.orgName(), style = MaterialTheme.typography.bodyMedium)

        Button(onClick = { nav.navigate("scan") }, modifier = Modifier.fillMaxWidth().padding(top = 24.dp)) {
            Icon(Icons.Filled.QrCodeScanner, null, modifier = Modifier.padding(end = 8.dp))
            Text("مسح باركود")
        }
        Button(onClick = { nav.navigate("search") }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Search, null, modifier = Modifier.padding(end = 8.dp))
            Text("بحث الأصناف")
        }
        Button(onClick = { nav.navigate("adjust") }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Filled.Inventory2, null, modifier = Modifier.padding(end = 8.dp))
            Text("جرد المخزون")
        }
        OutlinedButton(
            onClick = {
                scope.launch {
                    repo.logout()
                    nav.navigate("login") { popUpTo(0) }
                }
            },
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        ) { Text("تسجيل الخروج") }
    }
}
