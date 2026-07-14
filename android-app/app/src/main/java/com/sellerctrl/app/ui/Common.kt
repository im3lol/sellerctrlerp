package com.sellerctrl.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sellerctrl.app.data.ItemDto
import kotlin.math.roundToLong

fun fmt(n: Double): String {
    val r = n.roundToLong()
    return if (n == r.toDouble()) r.toString() else String.format("%.2f", n)
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
