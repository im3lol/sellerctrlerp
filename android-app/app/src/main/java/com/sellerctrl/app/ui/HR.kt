package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.EmployeeSaveReq
import com.sellerctrl.app.data.LeaveCreateReq
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmployeeFormScreen(nav: NavController, id: String) {
    val isNew = id == "new"
    val scope = rememberCoroutineScope()
    var loaded by remember { mutableStateOf(isNew) }
    var fullName by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var position by remember { mutableStateOf("") }
    var department by remember { mutableStateOf("") }
    var payType by remember { mutableStateOf("MONTHLY") }
    var basicSalary by remember { mutableStateOf("") }
    var allowances by remember { mutableStateOf("") }
    var deductions by remember { mutableStateOf("") }
    var taxRate by remember { mutableStateOf("") }
    var payPicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) {
        if (!isNew) {
            try {
                val e = ServiceLocator.repo.employeeEdit(id)
                fullName = e.fullName; code = e.employeeCode; position = e.position; department = e.department; payType = e.payType
                basicSalary = fmt(e.basicSalary); allowances = fmt(e.allowances); deductions = fmt(e.deductions); taxRate = fmt(e.taxRate)
            } catch (e: Exception) { error = e.message ?: "تعذّر التحميل" }
            loaded = true
        }
    }

    fun save() {
        if (fullName.trim().isBlank()) { error = "أدخل اسم الموظف"; return }
        busy = true; error = null
        scope.launch {
            try {
                ServiceLocator.repo.employeeSave(EmployeeSaveReq(if (isNew) null else id, fullName.trim(), code.ifBlank { null }, position.ifBlank { null }, department.ifBlank { null },
                    payType, basicSalary.toDoubleOrNull() ?: 0.0, allowances.toDoubleOrNull() ?: 0.0, deductions.toDoubleOrNull() ?: 0.0, taxRate.toDoubleOrNull() ?: 0.0))
                nav.popBackStack()
            } catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(if (isNew) "موظف جديد" else "تعديل موظف") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(fullName, { fullName = it }, label = { Text("الاسم الكامل *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(code, { code = it }, label = { Text("الكود الوظيفي") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(position, { position = it }, label = { Text("المسمى") }, singleLine = true, modifier = Modifier.weight(1f))
                OutlinedTextField(department, { department = it }, label = { Text("القسم") }, singleLine = true, modifier = Modifier.weight(1f))
            }
            OutlinedButton(onClick = { payPicker = true }, modifier = Modifier.fillMaxWidth()) { Text("نوع الأجر: ${if (payType == "HOURLY") "بالساعة" else "شهري"}") }
            OutlinedTextField(basicSalary, { basicSalary = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text(if (payType == "HOURLY") "أجر الساعة" else "الراتب الأساسي") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(allowances, { allowances = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("بدلات") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                OutlinedTextField(deductions, { deductions = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("خصومات") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
            }
            OutlinedTextField(taxRate, { taxRate = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("نسبة الضريبة %") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (payPicker) OptionPickerDialog("نوع الأجر", listOf("MONTHLY" to "شهري", "HOURLY" to "بالساعة"), onDismiss = { payPicker = false }) { id2, _ -> payType = id2; payPicker = false }
}

private val LEAVE_TYPES = listOf("ANNUAL" to "إجازة سنوية", "SICK" to "إجازة مرضية", "UNPAID" to "بدون أجر", "OTHER" to "أخرى")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeaveFormScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var employees by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var empId by remember { mutableStateOf("") }
    var empName by remember { mutableStateOf("") }
    var leaveType by remember { mutableStateOf("ANNUAL") }
    var startDate by remember { mutableStateOf(todayIso()) }
    var endDate by remember { mutableStateOf(todayIso()) }
    var reason by remember { mutableStateOf("") }
    var empPicker by remember { mutableStateOf(false) }
    var typePicker by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        employees = try { ServiceLocator.repo.docList("api/v1/hr/employees").map { it.id to it.title } } catch (e: Exception) { emptyList() }
    }

    fun save() {
        if (empId.isBlank()) { error = "اختر الموظف"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.leaveCreate(LeaveCreateReq(empId, leaveType, startDate, endDate, reason.ifBlank { null })); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text("طلب إجازة جديد") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = { empPicker = true }, modifier = Modifier.fillMaxWidth()) { Text(if (empName.isBlank()) "اختر الموظف *" else "الموظف: $empName") }
            OutlinedButton(onClick = { typePicker = true }, modifier = Modifier.fillMaxWidth()) { Text("النوع: ${LEAVE_TYPES.firstOrNull { it.first == leaveType }?.second ?: leaveType}") }
            OutlinedTextField(startDate, { startDate = it }, label = { Text("من تاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(endDate, { endDate = it }, label = { Text("إلى تاريخ") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(reason, { reason = it }, label = { Text("السبب") }, modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
        }
    }

    if (empPicker) OptionPickerDialog("اختر الموظف", employees, onDismiss = { empPicker = false }) { id, label -> empId = id; empName = label; empPicker = false }
    if (typePicker) OptionPickerDialog("نوع الإجازة", LEAVE_TYPES, onDismiss = { typePicker = false }) { id, _ -> leaveType = id; typePicker = false }
}
