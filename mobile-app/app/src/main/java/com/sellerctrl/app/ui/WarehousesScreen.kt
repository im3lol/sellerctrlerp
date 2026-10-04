package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.WarehouseDto
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WarehousesScreen(nav: NavController) {
    var warehouses by remember { mutableStateOf<List<WarehouseDto>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() {
        error = null
        runCatching { ServiceLocator.repo.warehouses() }
            .onSuccess { warehouses = it }
            .onFailure { error = tr("تعذّر تحميل المخازن"); warehouses = emptyList() }
    }
    LaunchedEffect(Unit) { refresh() }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text(tr("المخازن")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("رجوع")) } },
            actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, tr("تحديث")) } },
        )
    }) { pad ->
        when (val rows = warehouses) {
            null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
                if (rows.isEmpty()) item { AppCard(Modifier.fillMaxWidth()) { Text(tr("لا توجد مخازن متاحة."), Modifier.padding(20.dp), color = MaterialTheme.colorScheme.outline) } }
                items(rows, key = { it.id }) { warehouse -> AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text(warehouse.name, style = MaterialTheme.typography.titleMedium)
                        Text(tr("مخزن فعّال يمكن اختياره في الاستلام والتحويل والجرد."), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                    }
                } }
            }
        }
    }
}
