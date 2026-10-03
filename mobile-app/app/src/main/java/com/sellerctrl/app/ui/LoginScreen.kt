package com.sellerctrl.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.sellerctrl.app.R
import com.sellerctrl.app.ServiceLocator
import kotlinx.coroutines.launch

/** A focused, thumb-friendly sign-in screen. Credentials never leave the HTTPS API. */
@Composable
fun LoginScreen(onDone: () -> Unit) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        if (loading || username.isBlank() || password.isBlank()) return
        loading = true
        error = null
        scope.launch {
            try {
                ServiceLocator.repo.login(username, password)
                onDone()
            } catch (_: Exception) {
                error = "تعذّر تسجيل الدخول. تأكد من البريد وكلمة المرور ثم أعد المحاولة."
            } finally {
                loading = false
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Color(0xFFF7F9FF))) {
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(
                modifier = Modifier.fillMaxWidth().height(252.dp)
                    .clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp))
                    .background(BrandBlue).padding(horizontal = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Image(painterResource(R.drawable.sellerctrl_logo_white), "SellerCtrl", Modifier.width(210.dp))
                Spacer(Modifier.height(14.dp))
                Text("إدارة تجارتك من أي مكان", color = Color.White.copy(alpha = 0.82f), style = MaterialTheme.typography.bodyLarge)
            }
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 30.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("أهلاً بك", style = MaterialTheme.typography.headlineMedium)
                Text("سجّل الدخول للوصول إلى مساحة عملك بأمان.", color = MaterialTheme.colorScheme.outline)
                Spacer(Modifier.height(2.dp))
                OutlinedTextField(
                    value = username, onValueChange = { username = it },
                    label = { Text("البريد الإلكتروني أو اسم المستخدم") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = BrandBlue), modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = password, onValueChange = { password = it }, label = { Text("كلمة المرور") },
                    singleLine = true, visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = BrandBlue), modifier = Modifier.fillMaxWidth(),
                )
                error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Button(
                    onClick = { submit() }, enabled = !loading && username.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = BrandBlue),
                ) { if (loading) CircularProgressIndicator(color = Color.White) else Text("تسجيل الدخول") }
                Text(
                    text = "لا يتم حفظ كلمة المرور على الهاتف.",
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
        }
    }
}
