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
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.ApprovalDto
import com.sellerctrl.app.data.ApprovalInboxDto
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalInboxScreen(nav: NavController) {
    var scopeName by remember { mutableStateOf("pending") }
    var inbox by remember { mutableStateOf<ApprovalInboxDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyId by remember { mutableStateOf<String?>(null) }
    var rejectTarget by remember { mutableStateOf<ApprovalDto?>(null) }
    var rejectReason by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    suspend fun refresh() {
        error = null
        runCatching { ServiceLocator.repo.approvals(scopeName) }
            .onSuccess { inbox = it }
            .onFailure { error = "تعذّر تحميل صندوق الموافقات" }
    }
    LaunchedEffect(scopeName) { inbox = null; refresh() }
    fun decide(row: ApprovalDto, decision: String, comment: String? = null) {
        busyId = row.id; error = null
        scope.launch {
            runCatching { ServiceLocator.repo.decideApproval(row.id, decision, comment) }
                .onSuccess { rejectTarget = null; rejectReason = ""; refresh() }
                .onFailure { error = it.message ?: "تعذّر حفظ القرار" }
            busyId = null
        }
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("الموافقات") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } },
            actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, "تحديث") } },
        )
    }) { pad ->
        val data = inbox
        when {
            data == null && error == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            data == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (data.canDecide) Button(onClick = { scopeName = "pending" }, modifier = Modifier.weight(1f), enabled = scopeName != "pending") { Text("بانتظارك") }
                        OutlinedButton(onClick = { scopeName = "mine" }, modifier = Modifier.weight(1f), enabled = scopeName != "mine") { Text("طلباتي") }
                        if (data.canDecide) OutlinedButton(onClick = { scopeName = "done" }, modifier = Modifier.weight(1f), enabled = scopeName != "done") { Text("المكتملة") }
                    }
                }
                error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
                if (data.rows.isEmpty()) item { AppCard(Modifier.fillMaxWidth()) { Text(if (scopeName == "pending") "لا توجد موافقات بانتظارك." else "لا توجد طلبات في هذه القائمة.", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.outline) } }
                items(data.rows, key = { it.id }) { row ->
                    AppCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("${approvalType(row.entityType)} • ${row.entityNumber ?: "بدون رقم"}", style = MaterialTheme.typography.titleSmall)
                            row.amount?.let { Text(money(it), style = MaterialTheme.typography.titleMedium, color = BrandBlue) }
                            Text(row.reason, style = MaterialTheme.typography.bodyMedium)
                            Text(approvalMeta(row), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                            row.comment?.let { Text("ملاحظة: $it", style = MaterialTheme.typography.bodySmall) }
                            if (scopeName == "pending" && data.canDecide && row.status == "PENDING") {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(onClick = { decide(row, "APPROVE") }, enabled = busyId == null, modifier = Modifier.weight(1f)) { Text(if (busyId == row.id) "جارٍ الحفظ…" else "اعتماد") }
                                    OutlinedButton(onClick = { rejectTarget = row }, enabled = busyId == null, modifier = Modifier.weight(1f)) { Text("رفض", color = Color(0xFFB91C1C)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    rejectTarget?.let { row -> AlertDialog(
        onDismissRequest = { if (busyId == null) rejectTarget = null },
        title = { Text("سبب الرفض") },
        text = { OutlinedTextField(value = rejectReason, onValueChange = { rejectReason = it }, label = { Text("اكتب السبب ليعرف صاحب الطلب ما الذي يعدله") }, modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton(onClick = { decide(row, "REJECT", rejectReason) }, enabled = rejectReason.trim().isNotEmpty() && busyId == null) { Text("تأكيد الرفض") } },
        dismissButton = { TextButton(onClick = { rejectTarget = null }, enabled = busyId == null) { Text("إلغاء") } },
    ) }
}

private fun approvalType(type: String) = when (type) {
    "PURCHASE_ORDER" -> "أمر شراء"
    "SALES_ORDER" -> "أمر بيع"
    "STOCK_ADJUSTMENT" -> "تسوية مخزون"
    "PAYMENT" -> "سند صرف"
    "EXPENSE" -> "مصروف"
    "EXPENSE_CLAIM" -> "مطالبة مصروفات"
    else -> type
}

private fun approvalMeta(row: ApprovalDto): String = buildList {
    row.requestedByName?.let { add("طلبه $it") }
    add(row.requestedAt.substringBefore("T"))
    when (row.status) {
        "APPROVED" -> add("معتمد")
        "REJECTED" -> add("مرفوض")
        else -> add("بانتظار القرار")
    }
}.joinToString(" • ")
