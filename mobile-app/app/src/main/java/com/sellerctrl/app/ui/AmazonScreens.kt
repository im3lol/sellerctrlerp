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
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.BuyBoxDto
import com.sellerctrl.app.data.BuyBoxRowDto
import com.sellerctrl.app.data.FbaPlanDto
import com.sellerctrl.app.data.FbaPlanRowDto
import com.sellerctrl.app.data.AmazonHealthDto
import com.sellerctrl.app.data.AmazonOperationsDto
import com.sellerctrl.app.data.TfCreateLine
import com.sellerctrl.app.data.TfCreateReq
import com.sellerctrl.app.data.ReturnDecisionReq
import com.sellerctrl.app.data.FbaReconciliationDto
import com.sellerctrl.app.data.SyncStatusDto
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AmazonHubScreen(nav: NavController, code: String) {
    val tools = listOf(
        "المزامنة اليومية" to ("اسحب المنتجات والأوامر والتسويات أو نفّذ تدقيق FBA" to "amazon_sync/$code"),
        "صحة Amazon" to ("الطلبات والتسويات والتنبيهات التي تحتاج متابعة" to "amazon_health/$code"),
        "مراقبة Buy Box" to ("الأسعار والمنافسة وحالة الفوز لكل منتج" to "buy_box/$code"),
        "خطة FBA" to ("المخزون الحالي والمبيعات واقتراح إعادة التوريد" to "fba_plan/$code"),
        "مطابقة FBA" to ("قارن رصيد Amazon برصيد النظام وأنشئ مسودة تسوية عند الحاجة" to "fba_reconciliation/$code"),
        "الدفعات والرسوم والمرتجعات" to ("استورد وعالج التسويات، المرتجعات، وتعويضات FBA" to "amazon_operations/$code"),
    )
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("لوحة Amazon") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } },
        )
    }) { pad ->
        LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { AppCard(Modifier.fillMaxWidth(), container = Color(0xFFEFF6FF), border = null) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("تشغيل Amazon من الهاتف", style = MaterialTheme.typography.titleLarge, color = BrandBlue)
                    Text("كل عملية مرتبطة بنفس بيانات النظام وصلاحيات المستخدم. المسودات والترحيل يبقون خطوات منفصلة وواضحة.", style = MaterialTheme.typography.bodySmall)
                }
            } }
            items(tools, key = { it.first }) { (title, pair) ->
                AppCard(onClick = { nav.navigate(pair.second) }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(title, style = MaterialTheme.typography.titleMedium)
                            Text(pair.first, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        }
                        Icon(Icons.Filled.ChevronLeft, null, tint = BrandBlue)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AmazonSyncScreen(nav: NavController, code: String) {
    val syncTypes = listOf(
        "products" to ("كتالوج المنتجات" to "يجلب المنتجات ويطابقها بالـ ASIN دون إنشاء أصناف مكررة."),
        "orders" to ("أوامر Amazon" to "يستورد أحدث أوامر البيع في الخلفية."),
        "settlements" to ("التسويات والرسوم" to "يجلب تقارير التسوية؛ الترحيل المحاسبي له مراجعة مستقلة."),
        "inventory" to ("تدقيق مخزون FBA" to "يقارن مخزون Amazon بالنظام ولا يغير المخزون تلقائيًا."),
    )
    var statuses by remember { mutableStateOf<Map<String, SyncStatusDto>>(emptyMap()) }
    var starting by remember { mutableStateOf<String?>(null) }
    // A queue worker can take a few seconds to create its sync-run row. Keep polling
    // after a successful start instead of incorrectly showing the initial `idle` as done.
    var queuedKinds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() {
        val latest = syncTypes.associate { (kind, _) ->
            kind to runCatching { ServiceLocator.repo.amazonSyncStatus(code, kind) }
                .getOrElse { SyncStatusDto(kind = kind, phase = "idle") }
        }
        statuses = latest
        queuedKinds = queuedKinds.filter { latest[it]?.phase == "idle" }.toSet()
    }
    LaunchedEffect(code) { refresh() }
    val polling = queuedKinds.isNotEmpty() || statuses.values.any { it.phase == "running" }
    LaunchedEffect(code, polling) {
        if (polling) {
            delay(5_000)
            refresh()
        }
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("مزامنة Amazon") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } },
            actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, "تحديث") } },
        )
    }) { pad ->
        LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item { AppCard(Modifier.fillMaxWidth(), container = Color(0xFFEFF6FF), border = null) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("مزامنة آمنة في الخلفية", style = MaterialTheme.typography.titleMedium, color = BrandBlue)
                    Text("يمكنك متابعة حالة كل مصدر هنا. مزامنة المخزون تدقيق فقط، ولا تنشئ حركة مخزنية أو قيدًا تلقائيًا.", style = MaterialTheme.typography.bodySmall)
                }
            } }
            error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
            items(syncTypes, key = { it.first }) { (kind, copy) ->
                val status = statuses[kind] ?: SyncStatusDto(kind = kind)
                val active = starting == kind || kind in queuedKinds || status.phase == "running"
                AppCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(copy.first, style = MaterialTheme.typography.titleSmall)
                        Text(copy.second, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
                        Text(syncStatusText(status), style = MaterialTheme.typography.labelMedium, color = syncStatusColor(status.phase))
                        Button(
                            onClick = {
                                starting = kind; error = null
                                scope.launch {
                                    runCatching { ServiceLocator.repo.startAmazonSync(code, kind) }
                                        .onSuccess { queuedKinds = queuedKinds + kind; refresh() }
                                        .onFailure { error = it.message ?: "تعذّر بدء المزامنة" }
                                    starting = null
                                }
                            },
                            enabled = !active && starting == null,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (active) "جارٍ التنفيذ…" else "بدء المزامنة") }
                    }
                }
            }
        }
    }
}

private fun syncStatusText(status: SyncStatusDto): String = when (status.phase) {
    "running" -> listOfNotNull("جارٍ العمل في الخلفية", status.total?.let { "$it سجل" }).joinToString(" • ")
    "done" -> listOfNotNull(
        "اكتملت آخر مزامنة",
        status.created?.let { "أضيف $it" },
        status.linked?.let { "رُبط $it" },
        status.imported?.let { "استورد $it" },
        status.posted?.let { "رُحّل $it" },
        status.withDiff?.let { "$it فروق" },
    ).joinToString(" • ")
    "error" -> status.error ?: "تعذّرت آخر مزامنة"
    else -> "لم تُشغّل من التطبيق بعد"
}

@Composable private fun syncStatusColor(phase: String): Color = when (phase) {
    "done" -> Color(0xFF047857)
    "error" -> MaterialTheme.colorScheme.error
    "running" -> Color(0xFFB45309)
    else -> MaterialTheme.colorScheme.outline
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FbaReconciliationScreen(nav: NavController, code: String) {
    var data by remember { mutableStateOf<FbaReconciliationDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() { error = null; runCatching { ServiceLocator.repo.fbaReconciliation(code) }.onSuccess { data = it }.onFailure { error = "تعذّر تحميل تدقيق FBA" } }
    LaunchedEffect(code) { refresh() }
    Scaffold(topBar = { TopAppBar(title = { Text("مطابقة FBA") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } }, actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, "تحديث") } }) }) { pad ->
        val value = data
        when {
            value == null && error == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            error != null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            value!!.audit == null -> Box(Modifier.fillMaxSize().padding(pad).padding(24.dp), contentAlignment = Alignment.Center) { Text("لا يوجد تدقيق FBA مكتمل حتى الآن.") }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { AppCard(Modifier.fillMaxWidth(), border = null) { Column(Modifier.padding(16.dp)) { Text("${value!!.audit!!.withDiff} فرق كمي • ${value!!.audit!!.lost} مفقود • ${value!!.audit!!.damaged} تالف", style = MaterialTheme.typography.titleMedium); Text("آخر تدقيق: ${value!!.audit!!.finishedAt ?: value!!.audit!!.createdAt}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) } } }
                item { Button(onClick = { creating = true; scope.launch { runCatching { ServiceLocator.repo.createFbaAdjustment(code) }.onSuccess { id -> nav.navigate("adjustment/$id") }.onFailure { error = it.message ?: "تعذّر إنشاء مسودة التسوية" }; creating = false } }, enabled = !creating && value!!.audit!!.withDiff > 0, modifier = Modifier.fillMaxWidth()) { Text(if (creating) "جارٍ إنشاء المسودة…" else "إنشاء مسودة تسوية من LOST / FOUND") } }
                item { Text("فروق الأصناف", style = MaterialTheme.typography.titleMedium) }
                items(value!!.lines, key = { it.id }) { line -> AppCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text(line.itemName ?: line.code, style = MaterialTheme.typography.titleSmall); Text(listOfNotNull(line.code, line.asin).joinToString(" • "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("النظام: ${fmt(line.erpQty)}"); Text("Amazon: ${line.amazonTotal}"); Text("الفرق: ${fmt(line.diff)}", color = if (line.diff == 0.0) Color(0xFF059669) else Color(0xFFDC2626)) }; Text(line.status, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline) } } }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AmazonOperationsScreen(nav: NavController, code: String) {
    var data by remember { mutableStateOf<AmazonOperationsDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busyReimbursementId by remember { mutableStateOf<String?>(null) }
    var confirmSettlementPost by remember { mutableStateOf(false) }
    var postingSettlements by remember { mutableStateOf(false) }
    var returnDecisionId by remember { mutableStateOf<String?>(null) }
    var returnChoice by remember { mutableStateOf("RECEIVED|SELLABLE") }
    var returnChoicePicker by remember { mutableStateOf(false) }
    var confirmingReturn by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() { error = null; runCatching { ServiceLocator.repo.amazonOperations(code) }.onSuccess { data = it }.onFailure { error = "تعذّر تحميل عمليات Amazon" } }
    LaunchedEffect(code) { refresh() }
    Scaffold(topBar = { TopAppBar(title = { Text("عمليات Amazon") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } }, actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, "تحديث") } }) }) { pad ->
        val value = data
        when {
            value == null && error == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            error != null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text(value!!.platform.name, style = MaterialTheme.typography.titleMedium) }
                item { Text("التسويات والرسوم", style = MaterialTheme.typography.titleMedium) }
                item { Button(onClick = { confirmSettlementPost = true }, enabled = !postingSettlements, modifier = Modifier.fillMaxWidth()) { Text(if (postingSettlements) "جارٍ ترحيل التسويات…" else "ترحيل التسويات المحررة") } }
                if (value!!.settlements.isEmpty()) item { EmptyState("لا توجد تسويات مستوردة حتى الآن.") }
                items(value!!.settlements, key = { "s-${it.id}" }) { row -> AppCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text(row.type, style = MaterialTheme.typography.titleSmall); Text("${row.orderId ?: row.sku ?: "بدون مرجع"} • ${money(row.total)}", style = MaterialTheme.typography.bodySmall); Text(if (row.posted) "مُرحّلة" else "بانتظار المراجعة والترحيل", style = MaterialTheme.typography.labelSmall, color = if (row.posted) Color(0xFF059669) else Color(0xFFB45309)) } } }
                item { Text("مرتجعات Amazon", style = MaterialTheme.typography.titleMedium) }
                if (value!!.returns.isEmpty()) item { EmptyState("لا توجد مرتجعات مستوردة.") }
                items(value!!.returns, key = { "r-${it.id}" }) { row -> AppCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text("${row.orderId} • ${row.sku}", style = MaterialTheme.typography.titleSmall); Text("الكمية: ${fmt(row.quantity)}${row.disposition?.let { " • $it" } ?: ""}", style = MaterialTheme.typography.bodySmall); Text(if (row.salesReturnId != null) "تم إنشاء مسودة مرتجع للمراجعة" else "بانتظار ربطها بدورة المرتجع", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline); if (row.salesReturnId != null) Button(onClick = { returnDecisionId = row.salesReturnId; returnChoice = "RECEIVED|SELLABLE" }, enabled = !confirmingReturn, modifier = Modifier.fillMaxWidth()) { Text("اتخاذ قرار الاستلام") } } } }
                item { Text("تعويضات FBA", style = MaterialTheme.typography.titleMedium) }
                if (value!!.reimbursements.isEmpty()) item { EmptyState("لا توجد تعويضات معلقة.") }
                items(value!!.reimbursements, key = { "b-${it.id}" }) { row -> AppCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text(row.reimbursementId, style = MaterialTheme.typography.titleSmall); Text("${row.sku ?: "بدون SKU"} • ${money(row.amountTotal)}", style = MaterialTheme.typography.bodySmall); row.matchedLoss?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Color(0xFFB45309)) }; Button(onClick = { busyReimbursementId = row.id; scope.launch { runCatching { ServiceLocator.repo.recognizeReimbursement(code, row.id) }.onSuccess { refresh() }.onFailure { error = it.message ?: "تعذّر إنشاء مسودة التعويض" }; busyReimbursementId = null } }, enabled = busyReimbursementId == null, modifier = Modifier.fillMaxWidth()) { Text(if (busyReimbursementId == row.id) "جارٍ إنشاء المسودة…" else "إنشاء قيد مسودة للمراجعة") } } } }
            }
        }
    }
    if (confirmSettlementPost) AlertDialog(
        onDismissRequest = { confirmSettlementPost = false },
        title = { Text("ترحيل التسويات؟") },
        text = { Text("سيتم إنشاء القيود المحاسبية للتسويات المحررة غير المرحلة فقط. لا يشمل ذلك البنود المؤجلة أو قبل تاريخ بدء الحسابات.") },
        confirmButton = { TextButton(onClick = { confirmSettlementPost = false; postingSettlements = true; scope.launch { runCatching { ServiceLocator.repo.postAmazonSettlements(code) }.onSuccess { refresh() }.onFailure { error = it.message ?: "تعذّر ترحيل التسويات" }; postingSettlements = false } }) { Text("ترحيل") } },
        dismissButton = { TextButton(onClick = { confirmSettlementPost = false }) { Text("إلغاء") } },
    )
    val choiceLabel = when (returnChoice) {
        "RECEIVED|SELLABLE" -> "استلمته سليمًا — يرجع للبيع"
        "RECEIVED|PACKAGING_DAMAGED" -> "العبوة تالفة والمنتج سليم"
        "RECEIVED|OPENED" -> "مفتوح — مخزون غير قابل للبيع كجديد"
        "RECEIVED|SCRATCHED" -> "مخربش — مخزون غير قابل للبيع كجديد"
        "RECEIVED|USED" -> "مستخدم — مخزون غير قابل للبيع كجديد"
        "RECEIVED|DESTROYED" -> "تالف خالص — إعدام"
        else -> "لم يصلني — في انتظار تعويض"
    }
    if (returnDecisionId != null) AlertDialog(
        onDismissRequest = { if (!confirmingReturn) returnDecisionId = null },
        title = { Text("قرار استلام المرتجع") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("اختر ما حدث فعليًا للمنتج. القرار يحدد أثر المخزون ولا يمكن أن يعيد التالف كمخزون قابل للبيع."); OutlinedButton(onClick = { returnChoicePicker = true }, modifier = Modifier.fillMaxWidth()) { Text(choiceLabel) } } },
        confirmButton = { TextButton(onClick = { val id = returnDecisionId ?: return@TextButton; confirmingReturn = true; val parts = returnChoice.split("|"); val decision = if (parts[0] == "RECEIVED") ReturnDecisionReq(kind = "RECEIVED", condition = parts[1]) else ReturnDecisionReq(kind = "NOT_RECEIVED", reason = "NEVER_ARRIVED"); scope.launch { runCatching { ServiceLocator.repo.confirmAmazonReturn(code, id, decision) }.onSuccess { returnDecisionId = null; refresh() }.onFailure { error = it.message ?: "تعذّر تأكيد المرتجع" }; confirmingReturn = false } }, enabled = !confirmingReturn) { Text(if (confirmingReturn) "جارٍ التأكيد…" else "تأكيد القرار") } },
        dismissButton = { TextButton(onClick = { returnDecisionId = null }, enabled = !confirmingReturn) { Text("إلغاء") } },
    )
    if (returnChoicePicker) OptionPickerDialog("حالة المرتجع", listOf(
        "RECEIVED|SELLABLE" to "استلمته سليمًا — يرجع للبيع",
        "RECEIVED|PACKAGING_DAMAGED" to "العبوة تالفة والمنتج سليم",
        "RECEIVED|OPENED" to "مفتوح — غير قابل للبيع كجديد",
        "RECEIVED|SCRATCHED" to "مخربش — غير قابل للبيع كجديد",
        "RECEIVED|USED" to "مستخدم — غير قابل للبيع كجديد",
        "RECEIVED|DESTROYED" to "تالف خالص — إعدام",
        "NOT_RECEIVED|NEVER_ARRIVED" to "لم يصلني — في انتظار تعويض",
    ), { returnChoicePicker = false }) { id, _ -> returnChoice = id; returnChoicePicker = false }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AmazonHealthScreen(nav: NavController, code: String) {
    var data by remember { mutableStateOf<AmazonHealthDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() { error = null; runCatching { ServiceLocator.repo.amazonHealth(code) }.onSuccess { data = it }.onFailure { error = "تعذّر تحميل صحة Amazon" } }
    LaunchedEffect(code) { refresh() }
    Scaffold(topBar = { TopAppBar(title = { Text("صحة Amazon") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } }, actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, "تحديث") } }) }) { pad ->
        val value = data
        when {
            value == null && error == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            error != null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { AppCard(Modifier.fillMaxWidth(), container = if (value!!.openCount == 0) Color(0xFFECFDF5) else Color(0xFFFFF7E4), border = null) { Column(Modifier.padding(16.dp)) { Text(if (value!!.openCount == 0) "كل شيء سليم" else "${value!!.openCount} نقاط تحتاج متابعة", style = MaterialTheme.typography.titleMedium, color = if (value!!.openCount == 0) Color(0xFF047857) else Color(0xFF92400E)); Text(value!!.platform.name, style = MaterialTheme.typography.bodySmall) } } }
                items(value!!.checks, key = { it.key }) { check ->
                    AppCard(Modifier.fillMaxWidth()) { Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(check.title, style = MaterialTheme.typography.titleSmall); Text(check.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }; Text(check.count.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = if (check.count == 0) Color(0xFF059669) else Color(0xFFDC2626)) } }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BuyBoxScreen(nav: NavController, code: String) {
    var data by remember { mutableStateOf<BuyBoxDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    suspend fun refresh() {
        error = null
        runCatching { ServiceLocator.repo.buyBox(code) }.onSuccess { data = it }.onFailure { error = "تعذّر تحميل بيانات الـBuy Box" }
    }
    LaunchedEffect(code) { refresh() }
    Scaffold(topBar = {
        TopAppBar(title = { Text("مراقبة الـBuy Box") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } }, actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, "تحديث") } })
    }) { pad ->
        val value = data
        when {
            value == null && error == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            error != null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text(value!!.platform.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.outline) }
                item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BuyBoxKpi("خسرته", value!!.summary.lost, Color(0xFFDC2626), Modifier.weight(1f))
                    BuyBoxKpi("معاك", value!!.summary.won, Color(0xFF059669), Modifier.weight(1f))
                    BuyBoxKpi("غير ظاهر", value!!.summary.unavailable, Color(0xFF64748B), Modifier.weight(1f))
                } }
                item { Text("المنتجات", style = MaterialTheme.typography.titleMedium) }
                if (value!!.rows.isEmpty()) item { EmptyState("لا توجد قراءة بعد. حدّث بيانات Amazon من الموقع أولًا.") }
                items(value!!.rows, key = { it.itemId }) { BuyBoxRow(it) }
                value!!.checkedAt?.let { stamp -> item { Text("آخر تحديث: $stamp", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline) } }
            }
        }
    }
}

@Composable private fun BuyBoxKpi(label: String, count: Int, color: Color, modifier: Modifier) = AppCard(modifier, border = null) {
    Column(Modifier.padding(12.dp)) { Text(count.toString(), style = MaterialTheme.typography.titleLarge, color = color, fontWeight = FontWeight.Bold); Text(label, style = MaterialTheme.typography.labelSmall) }
}

@Composable private fun BuyBoxRow(row: BuyBoxRowDto) = AppCard(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(row.name, style = MaterialTheme.typography.titleSmall)
        Text(row.sku, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("سعري: ${row.myPrice?.let(::money) ?: "—"}", style = MaterialTheme.typography.bodySmall)
            Text("Buy Box: ${row.buyBoxPrice?.let(::money) ?: "—"}", style = MaterialTheme.typography.bodySmall)
        }
        val label = when (row.isWinner) { true -> "معاك"; false -> "خسرته"; null -> "غير ظاهر" }
        Text(label, style = MaterialTheme.typography.labelMedium, color = when (row.isWinner) { true -> Color(0xFF059669); false -> Color(0xFFDC2626); null -> MaterialTheme.colorScheme.outline })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FbaPlanScreen(nav: NavController, code: String) {
    var data by remember { mutableStateOf<FbaPlanDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var selectedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var creating by remember { mutableStateOf(false) }
    var createdMessage by remember { mutableStateOf<String?>(null) }
    var sourceId by remember { mutableStateOf<String?>(null) }
    var sourcePicker by remember { mutableStateOf(false) }
    var windowDays by remember { mutableStateOf("30") }
    var transitDays by remember { mutableStateOf("14") }
    var coverDays by remember { mutableStateOf("30") }
    val scope = rememberCoroutineScope()
    suspend fun refresh() {
        error = null
        val window = windowDays.toIntOrNull()?.coerceIn(7, 180) ?: 30
        val transit = transitDays.toIntOrNull()?.coerceIn(0, 90) ?: 14
        val cover = coverDays.toIntOrNull()?.coerceIn(7, 180) ?: 30
        runCatching { ServiceLocator.repo.fbaPlan(code, sourceId, window, transit, cover) }
            .onSuccess { plan -> data = plan; selectedIds = plan.rows.map { it.itemId }.toSet() }
            .onFailure { error = "تعذّر تحميل خطة FBA" }
    }
    LaunchedEffect(code) { refresh() }
    Scaffold(topBar = { TopAppBar(title = { Text("خطة شحن FBA") }, navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "رجوع") } }, actions = { IconButton(onClick = { scope.launch { refresh() } }) { Icon(Icons.Filled.Refresh, "تحديث") } }) }) { pad ->
        val value = data
        when {
            value == null && error == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            error != null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            value!!.state != "ready" -> Box(Modifier.fillMaxSize().padding(pad).padding(24.dp), contentAlignment = Alignment.Center) { Text(if (value!!.reason == "fba_warehouse_required") "حدّد مخزن Amazon FBA من إعدادات المنصة أولًا." else "أضف مخزنًا محليًا يمكن الشحن منه أولًا.", style = MaterialTheme.typography.bodyLarge) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text("من ${value!!.source!!.name} إلى ${value!!.platform.fbaWarehouseName ?: "Amazon FBA"}", style = MaterialTheme.typography.titleMedium) }
                item { Text("الاحتياج محسوب من آخر ${value!!.params.windowDays} يومًا، مع ${value!!.params.transitDays} يوم شحن و${value!!.params.coverDays} يوم تغطية.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline) }
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { sourcePicker = true }, modifier = Modifier.fillMaxWidth()) { Text("مخزن المصدر: ${value!!.source!!.name}") }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(windowDays, { windowDays = it.filter(Char::isDigit) }, label = { Text("نافذة البيع") }, suffix = { Text("يوم") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                            OutlinedTextField(transitDays, { transitDays = it.filter(Char::isDigit) }, label = { Text("الشحن") }, suffix = { Text("يوم") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                            OutlinedTextField(coverDays, { coverDays = it.filter(Char::isDigit) }, label = { Text("التغطية") }, suffix = { Text("يوم") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                        }
                        OutlinedButton(onClick = { scope.launch { refresh() } }, modifier = Modifier.fillMaxWidth()) { Text("إعادة حساب الخطة") }
                    }
                }
                value!!.auditAt?.let { item { Text("تدقيق Amazon: $it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline) } }
                item {
                    Button(
                        enabled = selectedIds.isNotEmpty() && !creating,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            val source = value!!.source!!
                            val destination = value!!.platform.fbaWarehouseId!!
                            val lines = value!!.rows.filter { it.itemId in selectedIds && it.sendQty > 0 }
                                .map { TfCreateLine(it.itemId, source.id, destination, it.sendQty) }
                            if (lines.isEmpty()) { error = "اختر صنفًا بكمية شحن أكبر من صفر"; return@Button }
                            creating = true; createdMessage = null
                            scope.launch {
                                runCatching {
                                    ServiceLocator.repo.transferCreate(TfCreateReq(todayIso(), "خطة شحن FBA من Amazon", lines))
                                }.onSuccess { id ->
                                    createdMessage = "تم إنشاء مسودة التحويل. راجعها ثم أكّدها."
                                    nav.navigate("transfer/$id")
                                }.onFailure { exception -> error = exception.message ?: "تعذّر إنشاء مسودة التحويل" }
                                creating = false
                            }
                        },
                    ) { Text(if (creating) "جارٍ إنشاء المسودة…" else "إنشاء مسودة شحن (${selectedIds.size})") }
                }
                createdMessage?.let { item { Text(it, color = Color(0xFF047857), style = MaterialTheme.typography.bodySmall) } }
                if (value!!.rows.isEmpty()) item { EmptyState("كل المنتجات المباعة مغطاة؛ لا يوجد شحن مطلوب الآن.") }
                items(value!!.rows, key = { it.itemId }) { row -> FbaPlanRow(row, row.itemId in selectedIds) { checked -> selectedIds = if (checked) selectedIds + row.itemId else selectedIds - row.itemId } }
            }
        }
    }
    if (sourcePicker && data != null) OptionPickerDialog("اختر مخزن المصدر", data!!.sources.map { it.id to it.name }, { sourcePicker = false }) { id, _ -> sourceId = id; sourcePicker = false; scope.launch { refresh() } }
}

@Composable private fun FbaPlanRow(row: FbaPlanRowDto, selected: Boolean, onSelected: (Boolean) -> Unit) = AppCard(Modifier.fillMaxWidth()) {
    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = selected, onCheckedChange = onSelected)
            Text(row.name, style = MaterialTheme.typography.titleSmall)
        }
        Text(listOfNotNull(row.sku, row.asin).joinToString(" • ").ifBlank { row.code }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("أرسل: ${fmt(row.sendQty)}", fontWeight = FontWeight.Bold, color = BrandBlue); Text("المتاح عندك: ${fmt(row.sourceOnHand)}") }
        Text("Amazon: ${fmt(row.fbaAvailable)} متاح • ${fmt(row.fbaInbound)} في الطريق • يغطي ${fmt(row.daysOfCover)} يوم", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        if (row.short > 0) Text("ناقص ${fmt(row.short)} وحدة لتغطية الاحتياج", style = MaterialTheme.typography.bodySmall, color = Color(0xFFB45309))
    }
}

@Composable private fun EmptyState(text: String) = AppCard(Modifier.fillMaxWidth()) { Text(text, Modifier.padding(20.dp), color = MaterialTheme.colorScheme.outline) }
