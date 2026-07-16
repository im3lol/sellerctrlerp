package com.sellerctrl.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.sellerctrl.app.data.ItemDto
import kotlin.math.roundToLong

fun fmt(n: Double): String {
    val r = n.roundToLong()
    return if (n == r.toDouble()) r.toString() else String.format("%.2f", n)
}

// ── AppCard — the web's card: white surface, 1px #E5E7EB border, r=16px, flat.
// Material's filled Card is a grey elevated surface, which is why the app read
// as "not the web". Every screen uses these two overloads instead.

/** Default hairline border — matches the web's --border (#E5E7EB). */
@Composable
private fun cardBorder() = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)

@Composable
fun AppCard(
    modifier: Modifier = Modifier,
    container: Color = MaterialTheme.colorScheme.surface,
    border: BorderStroke? = cardBorder(),
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = container),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = border,
        content = content,
    )
}

@Composable
fun AppCard(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    container: Color = MaterialTheme.colorScheme.surface,
    border: BorderStroke? = cardBorder(),
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = container),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = border,
        content = content,
    )
}

/** Money with thousands separators + ج.م. */
fun money(n: Double): String = String.format("%,.0f ج.م", n)

/** Arabic label for a document status enum. */
fun statusAr(s: String): String = when (s) {
    "DRAFT" -> "مسودة"
    "CONFIRMED" -> "مؤكد"
    "POSTED" -> "مُرحّل"
    "DELIVERED" -> "مُسلّم"
    "INVOICED" -> "مفوتر"
    "CANCELLED" -> "ملغي"
    "PARTIALLY_DELIVERED" -> "تسليم جزئي"
    "PARTIALLY_RECEIVED" -> "استلام جزئي"
    "RECEIVED" -> "مستلم"
    "PAID" -> "مدفوع"
    "PARTIAL_PAID", "PARTIALLY_PAID" -> "مدفوع جزئياً"
    "UNPAID" -> "غير مدفوع"
    "OVERDUE" -> "متأخر"
    "APPROVED" -> "معتمد"
    "REJECTED" -> "مرفوض"
    "SENT" -> "مُرسل"
    "ACCEPTED" -> "مقبول"
    "ACTIVE" -> "نشط"
    "DISPOSED" -> "مستبعد"
    "FULLY_DEPRECIATED" -> "مُستهلك بالكامل"
    else -> s
}

@Composable
fun ItemCard(item: ItemDto, modifier: Modifier = Modifier) {
    Card(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(item.name, style = MaterialTheme.typography.titleMedium)
            Text("كود: ${item.code}", style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Stat("المتاح", fmt(item.available))
                Stat("الرصيد", fmt(item.stock))
                Stat("محجوز", fmt(item.reserved))
            }
            Spacer(Modifier.height(8.dp))
            Text("سعر البيع: ${fmt(item.sellPrice)} ج.م", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(value, style = MaterialTheme.typography.titleLarge)
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}
