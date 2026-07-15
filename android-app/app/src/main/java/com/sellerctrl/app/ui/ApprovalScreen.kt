package com.sellerctrl.app.ui

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
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.sellerctrl.app.data.DocRow
import kotlinx.coroutines.launch

/**
 * List of requests (leaves / expense claims) with inline موافقة/رفض on DRAFT rows.
 * `actionBase` + "/{id}/approve|reject" is POSTed via the bearer API.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalScreen(nav: NavController, title: String, listPath: String, actionBase: String, canReject: Boolean) {
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<DocRow>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        try { rows = ServiceLocator.repo.docList(listPath) } catch (e: Exception) { error = "تعذّر التحميل"; rows = emptyList() }
    }

    fun act(id: String, verb: String) {
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.postAction("$actionBase/$id/$verb"); reload++ }
            catch (e: Exception) { error = e.message ?: "خطأ" }
            finally { busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(title) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            actions = { val open = LocalOpenDrawer.current; IconButton(onClick = open) { Icon(Icons.Filled.Menu, "القائمة") } },
        )
    }) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            when {
                rows == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                rows!!.isEmpty() -> Text(error ?: "لا توجد طلبات", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.outline)
                else -> LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(rows!!) { r ->
                        Card(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(r.title, style = MaterialTheme.typography.titleSmall)
                                        r.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
                                    }
                                    r.amount?.let { Text(money(it), style = MaterialTheme.typography.titleSmall) }
                                    r.status?.let { AssistChip(onClick = {}, label = { Text(statusAr(it)) }) }
                                }
                                if (r.status == "DRAFT") {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(onClick = { act(r.id, "approve") }, enabled = !busy, modifier = Modifier.weight(1f)) { Text("موافقة") }
                                        if (canReject) OutlinedButton(
                                            onClick = { act(r.id, "reject") }, enabled = !busy, modifier = Modifier.weight(1f),
                                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFC62828)),
                                        ) { Text("رفض") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (rows != null && rows!!.isNotEmpty()) {
                error?.let { Text(it, Modifier.align(Alignment.BottomCenter).padding(16.dp), color = Color(0xFFC62828)) }
            }
        }
    }
}
