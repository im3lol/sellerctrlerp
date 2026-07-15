package com.sellerctrl.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.DocRow

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ListScreen(nav: NavController, title: String, path: String, detailPrefix: String? = null) {
    var rows by remember { mutableStateOf<List<DocRow>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(path) {
        try {
            rows = ServiceLocator.repo.docList(path)
        } catch (e: Exception) {
            error = "تعذّر التحميل — تأكد من الصلاحية"
            rows = emptyList()
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
        )
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            when {
                rows == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                rows!!.isEmpty() -> Text(error ?: "لا توجد بيانات", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> LazyColumn(Modifier.fillMaxSize().padding(12.dp)) {
                    items(rows!!) { r ->
                        DocCard(r, onClick = detailPrefix?.let { p -> { nav.navigate("$p/${r.id}") } })
                    }
                }
            }
        }
    }
}

@Composable
private fun DocCard(r: DocRow, onClick: (() -> Unit)? = null) {
    val base = Modifier.fillMaxWidth().padding(vertical = 4.dp)
    Card(if (onClick != null) base.clickable { onClick() } else base) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(r.title, style = MaterialTheme.typography.titleSmall)
                r.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                r.amount?.let { Text(money(it), style = MaterialTheme.typography.titleSmall) }
                r.status?.let {
                    AssistChip(onClick = {}, label = { Text(statusAr(it)) },
                        colors = AssistChipDefaults.assistChipColors(labelColor = MaterialTheme.colorScheme.primary))
                }
            }
        }
    }
}
