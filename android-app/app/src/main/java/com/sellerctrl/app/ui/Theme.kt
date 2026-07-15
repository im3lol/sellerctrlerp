package com.sellerctrl.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// SellerCtrl brand
val BrandBlue = Color(0xFF0A33D1)
val BrandYellow = Color(0xFFF7C52D)

private val Scheme = lightColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE7ECFF),
    onPrimaryContainer = BrandBlue,
    secondary = BrandYellow,
    onSecondary = Color(0xFF1A1A1A),
    background = Color(0xFFF6F7FB),
    surface = Color.White,
    surfaceVariant = Color(0xFFEEF1F8),
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}
