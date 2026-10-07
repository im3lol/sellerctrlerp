package com.sellerctrl.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import com.sellerctrl.app.ui.AppNav
import com.sellerctrl.app.ui.AppTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AppTheme {
                // Right-to-left in Arabic, left-to-right when the phone is set to English.
                CompositionLocalProvider(LocalLayoutDirection provides if (I18n.english) LayoutDirection.Ltr else LayoutDirection.Rtl) {
                    AppNav()
                }
            }
        }
    }
}
