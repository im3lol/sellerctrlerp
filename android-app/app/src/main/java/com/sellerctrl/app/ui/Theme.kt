package com.sellerctrl.app.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sellerctrl.app.R

// ── Brand tokens — mirrored 1:1 from the web's app/globals.css ──────────────
// Primary #0A33D1 · Yellow #F7C52D · bg #FFFFFF · text #101828 · cards r=16px
val BrandBlue = Color(0xFF0A33D1)
val BrandYellow = Color(0xFFF7C52D)
private val Foreground = Color(0xFF101828)      // --foreground 222 44% 11%
private val Muted = Color(0xFFF3F4F6)           // --muted 220 14% 96%
private val MutedForeground = Color(0xFF6B7280) // --muted-foreground 220 9% 46%
private val BorderColor = Color(0xFFE5E7EB)     // --border 220 13% 91%
private val Destructive = Color(0xFFDC2626)     // --destructive 0 72% 51%
private val SuccessGreen = Color(0xFF22C55E)    // --success 142 71% 45%

private val Scheme = lightColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE7ECFF),
    onPrimaryContainer = BrandBlue,
    secondary = BrandYellow,
    onSecondary = Foreground,
    tertiary = SuccessGreen,
    onTertiary = Color.White,
    background = Color.White,        // web bg is #FFFFFF, not grey
    onBackground = Foreground,
    surface = Color.White,
    onSurface = Foreground,
    surfaceVariant = Muted,
    onSurfaceVariant = MutedForeground,
    outline = MutedForeground,       // muted text (subtitles) reads as `outline`
    outlineVariant = BorderColor,
    error = Destructive,
    onError = Color.White,
)

// ── Thmanyah Sans (خط ثمانية) — the web's brand typeface ────────────────────
private val Thmanyah = FontFamily(
    Font(R.font.thmanyah_light, FontWeight.Light),
    Font(R.font.thmanyah_regular, FontWeight.Normal),
    Font(R.font.thmanyah_medium, FontWeight.Medium),
    Font(R.font.thmanyah_bold, FontWeight.Bold),
    Font(R.font.thmanyah_black, FontWeight.Black),
)

/** Material's defaults, restated on Thmanyah with the web's weight ladder. */
private val AppTypography = Typography().let { d ->
    Typography(
        displayLarge = d.displayLarge.copy(fontFamily = Thmanyah),
        displayMedium = d.displayMedium.copy(fontFamily = Thmanyah),
        displaySmall = d.displaySmall.copy(fontFamily = Thmanyah),
        headlineLarge = d.headlineLarge.copy(fontFamily = Thmanyah, fontWeight = FontWeight.Bold),
        headlineMedium = d.headlineMedium.copy(fontFamily = Thmanyah, fontWeight = FontWeight.Bold),
        headlineSmall = d.headlineSmall.copy(fontFamily = Thmanyah, fontWeight = FontWeight.Bold),
        titleLarge = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 28.sp),
        titleMedium = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 24.sp),
        titleSmall = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
        bodyLarge = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
        bodyMedium = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
        bodySmall = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp),
        labelLarge = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
        labelMedium = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
        labelSmall = TextStyle(fontFamily = Thmanyah, fontWeight = FontWeight.Medium, fontSize = 11.sp, lineHeight = 16.sp),
    )
}

// Web: --radius: 1rem → 16px cards; controls sit a step below.
private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, typography = AppTypography, shapes = AppShapes, content = content)
}
