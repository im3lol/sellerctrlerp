package com.sellerctrl.app.ui

import com.sellerctrl.app.tr

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
    Section(tr("لوحة التحكم"), Icons.Filled.Dashboard, "home", emptyList()),
    Section(tr("المنصات"), Icons.Filled.Storefront, "platforms", emptyList()),
    Section(tr("المحاسبة"), Icons.Filled.AccountBalance, null, listOf(
        Leaf(tr("دليل الحسابات"), "genlist/chart", tr("القيود والأستاذ")),
        Leaf(tr("القيود اليومية"), "journal", tr("القيود والأستاذ")),
        Leaf(tr("القيود المتكررة"), "recurring_journals", tr("القيود والأستاذ")),
        Leaf(tr("دفتر الأستاذ"), "statement/account", tr("القيود والأستاذ")),
        Leaf(tr("سندات القبض"), "genlist/sales-receipts", tr("العملاء")),
        Leaf(tr("كشف حساب العميل"), "statement/customer", tr("العملاء")),
        Leaf(tr("سندات الصرف"), "genlist/purchase-payments", tr("الموردون")),
        Leaf(tr("كشف حساب المورّد"), "statement/supplier", tr("الموردون")),
        Leaf(tr("المصروفات"), "expenses", tr("المصروفات والأصول")),
        Leaf(tr("المصروفات الدورية"), "recurring_expenses", tr("المصروفات والأصول")),
        Leaf(tr("الأصول الثابتة"), "assets", tr("المصروفات والأصول")),
        Leaf(tr("الحسابات البنكية"), "banks_manager", tr("البنوك والخزينة")),
        Leaf(tr("المطابقة البنكية"), "bank_recon", tr("البنوك والخزينة")),
        Leaf(tr("أعمار ذمم العملاء"), "aging/ar", tr("التقارير والمطابقات")),
        Leaf(tr("أعمار ذمم الموردين"), "aging/ap", tr("التقارير والمطابقات")),
        Leaf(tr("توقّع التدفق النقدي"), null, tr("التقارير والمطابقات")),
        Leaf(tr("مطابقة حسابات المراقبة"), null, tr("التقارير والمطابقات")),
        Leaf(tr("مراكز التكلفة"), "cost_centers", tr("الإعداد")),
        Leaf(tr("الفترات المالية"), "periods", tr("الإعداد")),
        Leaf(tr("الميزانية التقديرية"), "budget", tr("الإعداد")),
    )),
    Section(tr("المشتريات"), Icons.Filled.LocalShipping, null, listOf(
        Leaf(tr("الموردون"), "suppliers_manager", null),
        Leaf(tr("طلبات المواد"), "requisitions", tr("دورة الشراء")),
        Leaf(tr("أوامر الشراء"), "purchase_orders", tr("دورة الشراء")),
        Leaf(tr("إذون الاستلام"), "purchase_receipts", tr("دورة الشراء")),
        Leaf(tr("فواتير الشراء"), "purchase_invoices", tr("دورة الشراء")),
        Leaf(tr("تقرير الدفتر"), "genlist/purchases-ledger", tr("التقارير")),
        Leaf(tr("ترتيب الموردين"), "report/purchases-suppliers", tr("التقارير")),
        Leaf(tr("المشتريات حسب الصنف"), "report/purchases-items", tr("التقارير")),
    )),
    Section(tr("المخزون"), Icons.Filled.Inventory2, null, listOf(
        Leaf(tr("الأصناف"), "search", tr("الأصناف والأرصدة")),
        Leaf(tr("أرصدة المخزون"), "genlist/stock-balances", tr("الأصناف والأرصدة")),
        Leaf(tr("دفتر حركة المخزون"), "genlist/stock-ledger", tr("الأصناف والأرصدة")),
        Leaf(tr("مطابقة قيمة المخزون"), null, tr("الأصناف والأرصدة")),
        Leaf(tr("إذون الاستلام"), "purchase_receipts", tr("العمليات")),
        Leaf(tr("إذون الصرف"), "sales_deliveries", tr("العمليات")),
        Leaf(tr("تسويات المخزون"), "adjustments", tr("العمليات")),
        Leaf(tr("التحويلات المخزنية"), "transfers", tr("العمليات")),
        Leaf(tr("الحزم والمجموعات"), "bundles", tr("العمليات")),
        Leaf(tr("تنبيهات إعادة الطلب"), "alert/reorder", tr("التنبيهات والأدوات")),
        Leaf(tr("المخزون الراكد"), "alert/dead-stock", tr("التنبيهات والأدوات")),
        Leaf(tr("تنبيهات انتهاء الصلاحية"), "alert/expiry", tr("التنبيهات والأدوات")),
        Leaf(tr("ملصقات الباركود"), null, tr("التنبيهات والأدوات")),
    )),
    Section(tr("المبيعات"), Icons.Filled.ShoppingCart, null, listOf(
        Leaf(tr("العملاء"), "customers_manager", null),
        Leaf(tr("عروض الأسعار"), "quotations", tr("دورة البيع")),
        Leaf(tr("أوامر البيع"), "sales_orders", tr("دورة البيع")),
        Leaf(tr("فواتير البيع"), "sales_invoices", tr("دورة البيع")),
        Leaf(tr("الفواتير الدورية"), "recurring", tr("دورة البيع")),
        Leaf(tr("تقرير الدفتر"), "genlist/sales-ledger", tr("التقارير")),
        Leaf(tr("تقرير الأصناف"), "report/sales-items", tr("التقارير")),
        Leaf(tr("ربحية المنتجات"), null, tr("التقارير")),
        Leaf(tr("ترتيب العملاء"), "report/sales-customers", tr("التقارير")),
    )),
    Section(tr("المستثمرون"), Icons.Filled.Savings, "investors", emptyList()),
    Section(tr("الموارد البشرية"), Icons.Filled.Groups, null, listOf(
        Leaf(tr("الموظفون"), "employees", null),
        Leaf(tr("الإجازات"), "leaves", tr("الحضور والإجازات")),
        Leaf(tr("تقويم العطلات"), "genlist/holidays", tr("الحضور والإجازات")),
        Leaf(tr("مسيّرات الرواتب"), "payroll", tr("المالية")),
        Leaf(tr("مطالبات المصروفات"), "expense_claims", tr("المالية")),
    )),
    Section(tr("التقارير والتحليلات"), Icons.Filled.Assessment, null, listOf(
        Leaf(tr("ميزان المراجعة"), "reports", null),
        Leaf(tr("قائمة الدخل"), "income_statement", tr("القوائم المالية")),
        Leaf(tr("الميزانية العمومية"), "balance_sheet", tr("القوائم المالية")),
        Leaf(tr("التدفق النقدي"), "cash_flow", tr("القوائم المالية")),
        Leaf(tr("ضريبة القيمة المضافة"), null, tr("القوائم المالية")),
        Leaf(tr("المؤشرات المالية"), null, tr("التحليلات")),
        Leaf(tr("أرباح مراكز التكلفة"), null, tr("التحليلات")),
        Leaf(tr("إعادة تقييم العملات"), null, tr("التحليلات")),
    )),
    Section(tr("الأدوات"), Icons.Filled.Build, null, listOf(
        Leaf(tr("الاستيراد والتصدير"), null),
    )),
    Section(tr("الإدارة والإعدادات"), Icons.Filled.Settings, null, listOf(
        Leaf(tr("صلاحيات المستخدمين"), null),
        Leaf(tr("سجل التدقيق"), null),
        Leaf(tr("الإعدادات"), null),
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
            Text("SellerCtrl · v1.0", color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp)
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
        if (!enabled) Text(tr("قريباً"), color = BrandYellow.copy(alpha = 0.7f), fontSize = 10.sp)
    }
}
