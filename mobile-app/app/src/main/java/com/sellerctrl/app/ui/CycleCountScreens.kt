package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun CycleCountsScreen(nav: NavController) {
    var rows by remember { mutableStateOf<List<CountSessionDto>?>(null) }; var error by remember { mutableStateOf<String?>(null) }; var create by remember { mutableStateOf(false) }; val scope = rememberCoroutineScope()
    suspend fun refresh() { runCatching { ServiceLocator.repo.countSessions() }.onSuccess { rows = it }.onFailure { error = tr("تعذّر تحميل جلسات الجرد"); rows = emptyList() } }
    LaunchedEffect(Unit) { refresh() }
    Scaffold(topBar = { TopAppBar(title={Text(tr("الجرد الدوري"))}, navigationIcon={IconButton(onClick={nav.popBackStack()}){Icon(Icons.AutoMirrored.Filled.ArrowBack,tr("رجوع"))}}) }, floatingActionButton={ FloatingActionButton(onClick={create=true}){Icon(Icons.Filled.Add,tr("ورقة جرد جديدة"))} }) { pad ->
        when(val value=rows) { null -> Box(Modifier.fillMaxSize().padding(pad),contentAlignment=Alignment.Center){CircularProgressIndicator()}; else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) { error?.let{item{Text(it,color=MaterialTheme.colorScheme.error)}}; if(value.isEmpty()) item{Text(tr("لا توجد جلسات جرد."),color=MaterialTheme.colorScheme.outline)}; items(value,key={it.id}){r->AppCard(onClick={nav.navigate("cycle_count/${r.id}")},modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp)){Text(r.number,style=MaterialTheme.typography.titleMedium);Text(tr("${r.warehouseName} • ${r.lines} صنف • ${r.status}"),color=MaterialTheme.colorScheme.outline,style=MaterialTheme.typography.bodySmall)}}} } }
    }
    if(create) CountCreateDialog(onDismiss={create=false}) { id -> create=false; nav.navigate("cycle_count/$id") }
}

@Composable private fun CountCreateDialog(onDismiss:()->Unit,onCreated:(String)->Unit) { var wh by remember{mutableStateOf("")}; var warehouses by remember{mutableStateOf<List<WarehouseDto>>(emptyList())}; var picker by remember{mutableStateOf(false)}; var busy by remember{mutableStateOf(false)}; var error by remember{mutableStateOf<String?>(null)}; val scope=rememberCoroutineScope(); LaunchedEffect(Unit){warehouses=runCatching{ServiceLocator.repo.warehouses()}.getOrDefault(emptyList())}; AlertDialog(onDismissRequest=onDismiss,title={Text(tr("ورقة جرد جديدة"))},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){OutlinedButton(onClick={picker=true},modifier=Modifier.fillMaxWidth()){Text(warehouses.firstOrNull{it.id==wh}?.name ?: tr("اختر المخزن"))}; error?.let{Text(it,color=MaterialTheme.colorScheme.error)};Text(tr("سيتم تجميد رصيد النظام في الورقة للمراجعة، ولن يتغير المخزون قبل الترحيل."),style=MaterialTheme.typography.bodySmall)}},confirmButton={TextButton(enabled=wh.isNotBlank()&&!busy,onClick={busy=true;scope.launch{runCatching{ServiceLocator.repo.createCount(CountCreateReq(wh))}.onSuccess(onCreated).onFailure{error=it.message};busy=false}}){Text(if(busy)tr("جارٍ الإنشاء…") else tr("إنشاء"))}},dismissButton={TextButton(onClick=onDismiss){Text(tr("إلغاء"))}}); if(picker) OptionPickerDialog(tr("اختر المخزن"),warehouses.map{it.id to it.name},{picker=false}){id,_->wh=id;picker=false} }

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun CycleCountDetailScreen(nav: NavController, id: String) {
    var data by remember { mutableStateOf<CountDetailDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var counts by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var saving by remember { mutableStateOf(false) }
    var confirmPost by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load() {
        runCatching { ServiceLocator.repo.countDetail(id) }
            .onSuccess { data = it; counts = it.lines.associate { l -> l.itemId to (l.countedQty?.toString() ?: "") } }
            .onFailure { error = tr("تعذّر تحميل ورقة الجرد") }
    }
    LaunchedEffect(id) { load() }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text(data?.session?.number ?: tr("ورقة جرد")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("رجوع")) } },
        )
    }) { pad ->
        val d = data
        when {
            d == null && error == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            d == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) { Text(error!!, color = MaterialTheme.colorScheme.error) }
            else -> LazyColumn(Modifier.fillMaxSize().padding(pad).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Text("${d.session.warehouseName} • ${statusAr(d.session.status)}", color = MaterialTheme.colorScheme.outline) }
                items(d.lines, key = { it.itemId }) { line ->
                    AppCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(line.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                tr("${line.code}${line.binCode?.let { tr(" • موقع $it") } ?: ""} • رصيد النظام ${line.systemQty}"),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline,
                            )
                            OutlinedTextField(
                                value = counts[line.itemId] ?: "",
                                onValueChange = { v -> counts = counts + (line.itemId to v) },
                                label = { Text(tr("العدد الفعلي")) },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
                // The two actions belong to the sheet, not to a row. Nested inside items()
                // they repeated per line and were called outside the LazyColumn scope.
                item {
                    Button(
                        enabled = !saving,
                        onClick = {
                            saving = true
                            scope.launch {
                                runCatching { ServiceLocator.repo.saveCount(id, d.lines.map { CountSaveLine(it.itemId, counts[it.itemId]?.toDoubleOrNull()) }) }
                                    .onSuccess { load() }
                                    .onFailure { error = it.message }
                                saving = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (saving) tr("جارٍ الحفظ…") else tr("حفظ الأعداد للمراجعة")) }
                }
                if (d.session.status == "COUNTED") item {
                    Button(onClick = { confirmPost = true }, modifier = Modifier.fillMaxWidth()) { Text(tr("مراجعة وترحيل الفروق")) }
                }
            }
        }
    }
    if (confirmPost) AlertDialog(
        onDismissRequest = { confirmPost = false },
        title = { Text(tr("ترحيل الجرد؟")) },
        text = { Text(tr("سيتم إنشاء تسوية مخزون وترحيلها بالفروق المسجلة. لا يمكن تعديل جلسة الجرد بعدها.")) },
        confirmButton = {
            TextButton(onClick = {
                confirmPost = false
                saving = true
                scope.launch {
                    runCatching { ServiceLocator.repo.postAction("api/v1/inventory/cycle-count/$id/post") }
                        .onSuccess { load() }
                        .onFailure { error = it.message }
                    saving = false
                }
            }) { Text(tr("ترحيل")) }
        },
        dismissButton = { TextButton(onClick = { confirmPost = false }) { Text(tr("إلغاء")) } },
    )
}
