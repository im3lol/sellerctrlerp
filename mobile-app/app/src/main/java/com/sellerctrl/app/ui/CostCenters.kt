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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator
import com.sellerctrl.app.data.CostCenterSaveReq
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CostCenterFormScreen(nav: NavController, id: String) {
    val isNew = id == "new"
    val scope = rememberCoroutineScope()
    var loaded by remember { mutableStateOf(isNew) }
    var code by remember { mutableStateOf("") }
    var nameAr by remember { mutableStateOf("") }
    var nameEn by remember { mutableStateOf("") }
    var isActive by remember { mutableStateOf(true) }
    var confirmDelete by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) {
        if (!isNew) {
            try {
                val c = ServiceLocator.repo.costCenterEdit(id)
                code = c.code; nameAr = c.nameAr; nameEn = c.nameEn; isActive = c.isActive
            } catch (e: Exception) { error = e.message ?: "تعذّر التحميل" }
            loaded = true
        }
    }

    fun save() {
        if (code.isBlank()) { error = "الكود مطلوب"; return }
        if (nameAr.trim().length < 2) { error = "الاسم قصير جداً"; return }
        busy = true; error = null
        scope.launch {
            try { ServiceLocator.repo.costCenterSave(CostCenterSaveReq(if (isNew) null else id, code.trim(), nameAr.trim(), nameEn.ifBlank { null }, isActive)); nav.popBackStack() }
            catch (e: Exception) { error = e.message ?: "خطأ"; busy = false }
        }
    }

    Scaffold(topBar = {
        TopAppBar(title = { Text(if (isNew) "مركز تكلفة جديد" else "تعديل مركز تكلفة") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } })
    }) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(code, { code = it }, label = { Text("الكود *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(nameAr, { nameAr = it }, label = { Text("الاسم بالعربية *") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(nameEn, { nameEn = it }, label = { Text("الاسم بالإنجليزية") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(isActive, { isActive = it }); Text("نشط") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold) }
            Button(onClick = { save() }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "جارٍ الحفظ…" else "حفظ") }
            if (!isNew) OutlinedButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text("حذف") }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, title = { Text("حذف") }, text = { Text("متأكد من حذف المركز؟ (يُرفض لو مستخدم في قيود)") },
        confirmButton = {
            TextButton(onClick = {
                confirmDelete = false; busy = true; error = null
                scope.launch { try { ServiceLocator.repo.postAction("api/v1/accounting/cost-centers/$id/delete"); nav.popBackStack() } catch (e: Exception) { error = e.message ?: "خطأ" } finally { busy = false } }
            }) { Text("حذف", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { OutlinedButton(onClick = { confirmDelete = false }) { Text("إلغاء") } },
    )
}
