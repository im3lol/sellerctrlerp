package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Construction
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController

/** Visible only while a web feature is being moved to its native mobile workflow. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ParityScreen(nav: NavController, encodedLabel: String) {
    val label = Uri.decode(encodedLabel)
    Scaffold(topBar = {
        TopAppBar(
            title = { Text(label) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, tr("رجوع")) } },
        )
    }) { pad ->
        Column(
            Modifier.fillMaxSize().padding(pad).padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(Icons.Filled.Construction, null, tint = BrandBlue)
            Text(tr("نقل تجربة الهاتف جارٍ"), style = MaterialTheme.typography.titleLarge)
            Text(
                tr("هذه الوظيفة متاحة على الموقع. لا نعرضها كـ«قريبًا» لأن حالتها ليست كذلك؛ ستتحول إلى عملية موبايل كاملة ضمن خطة التكافؤ."),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}
