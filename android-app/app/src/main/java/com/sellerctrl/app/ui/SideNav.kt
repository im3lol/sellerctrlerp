package com.sellerctrl.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.sellerctrl.app.ServiceLocator

/** Opens the app drawer from anywhere (provided at the AppNav root). */
val LocalOpenDrawer = staticCompositionLocalOf<() -> Unit> { {} }

/** A drawer leaf. `route == null` → not yet in the app (shows "قريباً"). */
private data class Leaf(val label: String, val route: String?, val group: String? = null)
private data class Section(val heading: String, val icon: ImageVector, val headingRoute: String?, val items: List<Leaf>)

// Mirrors the web sidebar taxonomy (components/app-shell/nav-config.ts) 1:1.
private val NAV = listOf(
    Section("لوحة التحكم", Icons.Filled.Dashboard, "home", emptyList()),
    Section("المنصات", Icons.Filled.Storefront, "platforms", emptyList()),
    Section("المحاسبة", Icons.Filled.AccountBalance, null, listOf(
        Leaf("دليل الحسابات", "genlist/chart", "القيود والأستاذ"),
        Leaf("القيود اليومية", "journal", "القيود والأستاذ"),
        Leaf("القيود المتكررة", null, "القيود والأستاذ"),
        Leaf("دفتر الأستاذ", null, "القيود والأستاذ"),
        Leaf("سندات القبض", "genlist/sales-receipts", "العملاء"),
        Leaf("كشف حساب العميل", null, "العملاء"),
        Leaf("سندات الصرف", "genlist/purchase-payments", "الموردون"),
        Leaf("كشف حساب المورّد", null, "الموردون"),
        Leaf("المصروفات", "expenses", "المصروفات والأصول"),
        Leaf("الأصول الثابتة", "genlist/assets", "المصروفات والأصول"),
        Leaf("الحسابات البنكية", "banks_manager", "البنوك والخزينة"),
        Leaf("المطابقة البنكية", null, "البنوك والخزينة"),
        Leaf("تحليل الديون المتأخرة", null, "التقارير والمطابقات"),
        Leaf("توقّع التدفق النقدي", null, "التقارير والمطابقات"),
        Leaf("مطابقة حسابات المراقبة", null, "التقارير والمطابقات"),
        Leaf("مراكز التكلفة", null, "الإعداد"),
        Leaf("الفترات المالية", null, "الإعداد"),
        Leaf("الميزانية التقديرية", null, "الإعداد"),
    )),
    Section("المشتريات", Icons.Filled.LocalShipping, null, listOf(
        Leaf("الموردون", "suppliers_manager", null),
        Leaf("طلبات المواد", "requisitions", "دورة الشراء"),
        Leaf("أوامر الشراء", "purchase_orders", "دورة الشراء"),
        Leaf("إذون الاستلام", "purchase_receipts", "دورة الشراء"),
        Leaf("فواتير الشراء", "purchase_invoices", "دورة الشراء"),
        Leaf("تقرير الدفتر", null, "التقارير"),
        Leaf("ترتيب الموردين", "report/purchases-suppliers", "التقارير"),
        Leaf("المشتريات حسب الصنف", "report/purchases-items", "التقارير"),
    )),
    Section("المخزون", Icons.Filled.Inventory2, null, listOf(
        Leaf("الأصناف", "search", "الأصناف والأرصدة"),
        Leaf("أرصدة المخزون", null, "الأصناف والأرصدة"),
        Leaf("دفتر حركة المخزون", null, "الأصناف والأرصدة"),
        Leaf("مطابقة قيمة المخزون", null, "الأصناف والأرصدة"),
        Leaf("إذون الاستلام", "purchase_receipts", "العمليات"),
        Leaf("إذون الصرف", "sales_deliveries", "العمليات"),
        Leaf("تسويات المخزون", "genlist/adjustments", "العمليات"),
        Leaf("التحويلات المخزنية", "transfers", "العمليات"),
        Leaf("الحزم والمجموعات", null, "العمليات"),
        Leaf("تنبيهات إعادة الطلب", null, "التنبيهات والأدوات"),
        Leaf("المخزون الراكد", null, "التنبيهات والأدوات"),
        Leaf("تنبيهات انتهاء الصلاحية", null, "التنبيهات والأدوات"),
        Leaf("ملصقات الباركود", null, "التنبيهات والأدوات"),
    )),
    Section("المبيعات", Icons.Filled.ShoppingCart, null, listOf(
        Leaf("العملاء", "customers_manager", null),
        Leaf("عروض الأسعار", "quotations", "دورة البيع"),
        Leaf("أوامر البيع", "sales_orders", "دورة البيع"),
        Leaf("فواتير البيع", "sales_invoices", "دورة البيع"),
        Leaf("الفواتير الدورية", null, "دورة البيع"),
        Leaf("تقرير الدفتر", null, "التقارير"),
        Leaf("تقرير الأصناف", "report/sales-items", "التقارير"),
        Leaf("ربحية المنتجات", null, "التقارير"),
        Leaf("ترتيب العملاء", "report/sales-customers", "التقارير"),
    )),
    Section("المستثمرون", Icons.Filled.Savings, "investors", emptyList()),
    Section("الموارد البشرية", Icons.Filled.Groups, null, listOf(
        Leaf("الموظفون", "employees", null),
        Leaf("الإجازات", "leaves", "الحضور والإجازات"),
        Leaf("تقويم العطلات", "genlist/holidays", "الحضور والإجازات"),
        Leaf("مسير الرواتب", null, "المالية"),
        Leaf("مطالبات المصروفات", "expense_claims", "المالية"),
    )),
    Section("التقارير والتحليلات", Icons.Filled.Assessment, null, listOf(
        Leaf("ميزان المراجعة", "reports", null),
        Leaf("قائمة الدخل", "income_statement", "القوائم المالية"),
        Leaf("الميزانية العمومية", "balance_sheet", "القوائم المالية"),
        Leaf("التدفق النقدي", "cash_flow", "القوائم المالية"),
        Leaf("ضريبة القيمة المضافة", null, "القوائم المالية"),
        Leaf("المؤشرات المالية", null, "التحليلات"),
        Leaf("أرباح مراكز التكلفة", null, "التحليلات"),
        Leaf("إعادة تقييم العملات", null, "التحليلات"),
    )),
    Section("الأدوات", Icons.Filled.Build, null, listOf(
        Leaf("الاستيراد والتصدير", null),
    )),
    Section("الإدارة والإعدادات", Icons.Filled.Settings, null, listOf(
        Leaf("صلاحيات المستخدمين", null),
        Leaf("سجل التدقيق", null),
        Leaf("الإعدادات", null),
    )),
)

private val BrandBlueDeep = Color(0xFF0A33D1)
private val NavSelected = Color(0x33FFFFFF)
private val NavHeadingBg = Color(0x14FFFFFF)

@Composable
fun SideNav(nav: NavController, current: String?, onNavigate: (String) -> Unit) {
    val expanded = remember { mutableStateMapOf<String, Boolean>() }
    Column(
        Modifier.fillMaxHeight().width(288.dp).background(BrandBlueDeep),
    ) {
        // Brand header (LTR wordmark, mirrors the web logo)
        androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Ltr) {
            Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("seller", color = Color.White.copy(alpha = 0.9f), fontWeight = FontWeight.Light, fontSize = 22.sp)
                Text("ctrl", color = Color.White, fontWeight = FontWeight.Black, fontSize = 22.sp)
                Spacer(Modifier.width(4.dp))
                Text("▸", color = BrandYellow, fontWeight = FontWeight.Black, fontSize = 16.sp)
            }
        }
        val org = ServiceLocator.repo.orgName()
        if (org.isNotEmpty()) Text(org, color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp, modifier = Modifier.padding(start = 20.dp, bottom = 8.dp))

        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
            items(NAV) { s ->
                val isOpen = expanded[s.heading] == true
                // Module heading row
                Row(
                    Modifier.fillMaxWidth()
                        .clickable {
                            if (s.items.isEmpty() && s.headingRoute != null) onNavigate(s.headingRoute)
                            else expanded[s.heading] = !isOpen
                        }
                        .padding(horizontal = 12.dp, vertical = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        Modifier.fillMaxWidth().background(if (isOpen) NavHeadingBg else Color.Transparent, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        androidx.compose.material3.Icon(s.icon, null, tint = Color.White, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(s.heading, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                        if (s.items.isNotEmpty()) androidx.compose.material3.Icon(
                            if (isOpen) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowLeft, null,
                            tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.size(18.dp),
                        )
                    }
                }
                // Expanded items, grouped
                if (isOpen) {
                    var lastGroup: String? = null
                    s.items.forEach { leaf ->
                        if (leaf.group != null && leaf.group != lastGroup) {
                            lastGroup = leaf.group
                            Text(leaf.group!!, color = BrandYellow.copy(alpha = 0.85f), fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(start = 48.dp, top = 10.dp, bottom = 4.dp))
                        }
                        LeafRow(leaf, selected = current == leaf.route && leaf.route != null, onNavigate)
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(16.dp)) {
            Text("SellerCtrl Workspace OS · v1.0", color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp)
        }
    }
}

@Composable
private fun LeafRow(leaf: Leaf, selected: Boolean, onNavigate: (String) -> Unit) {
    val enabled = leaf.route != null
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 1.dp)
            .background(if (selected) NavSelected else Color.Transparent, RoundedCornerShape(8.dp))
            .let { if (enabled) it.clickable { onNavigate(leaf.route!!) } else it }
            .padding(start = 48.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(leaf.label, color = Color.White.copy(alpha = if (enabled) 0.92f else 0.4f), fontSize = 14.sp, modifier = Modifier.weight(1f))
        if (!enabled) Text("قريباً", color = BrandYellow.copy(alpha = 0.7f), fontSize = 10.sp)
    }
}
