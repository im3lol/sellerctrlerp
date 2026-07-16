package com.sellerctrl.app.data

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query
import retrofit2.http.Url

@Serializable data class LoginReq(val username: String, val password: String, val token: String? = null)
@Serializable data class OrgDto(val id: String, val name: String)
@Serializable data class UserDto(val id: String, val name: String, val email: String? = null, val role: String)
@Serializable data class LoginResp(val token: String, val user: UserDto, val orgs: List<OrgDto> = emptyList())

@Serializable data class CodeDto(val type: String, val code: String)
@Serializable data class ItemDto(
    val id: String,
    val code: String,
    val name: String,
    val sellPrice: Double = 0.0,
    val image: String? = null,
    val stock: Double = 0.0,
    val reserved: Double = 0.0,
    val available: Double = 0.0,
    val codes: List<CodeDto> = emptyList(),
)
@Serializable data class ItemsResp(val data: List<ItemDto> = emptyList())
@Serializable data class ItemResp(val data: ItemDto)

@Serializable data class WarehouseDto(val id: String, val name: String)
@Serializable data class WarehousesResp(val data: List<WarehouseDto> = emptyList())
@Serializable data class CountLine(val itemId: String, val countedQty: Double)
@Serializable data class AdjustReq(val warehouseId: String, val reason: String? = null, val lines: List<CountLine>)
@Serializable data class OkResp(val ok: Boolean = false, val id: String? = null, val error: String? = null)

@Serializable data class PendingDto(val jeDraft: Int = 0, val siDraft: Int = 0, val piDraft: Int = 0, val soAwaiting: Int = 0, val poAwaiting: Int = 0)
@Serializable data class RecentSale(val number: String, val name: String, val amount: Double = 0.0)
@Serializable data class DashboardDto(
    val net: Double = 0.0, val cash: Double = 0.0, val ar: Double = 0.0, val ap: Double = 0.0,
    val inventoryValue: Double = 0.0, val salesMonth: Double = 0.0,
    val lowStock: Int = 0, val outOfStock: Int = 0, val overdueAR: Double = 0.0,
    val expiredCount: Int = 0, val nearExpiryCount: Int = 0,
    val pending: PendingDto = PendingDto(), val recentSales: List<RecentSale> = emptyList(),
)
@Serializable data class DashboardResp(val data: DashboardDto)

@Serializable data class DocRow(val id: String, val number: String, val title: String, val subtitle: String? = null, val amount: Double? = null, val status: String? = null)
@Serializable data class DocListResp(val data: List<DocRow> = emptyList())

@Serializable data class ReportsDto(
    val income: Double = 0.0, val expense: Double = 0.0, val net: Double = 0.0,
    val ar: Double = 0.0, val ap: Double = 0.0, val overdueAR: Double = 0.0, val overdueAP: Double = 0.0,
    val inventoryValue: Double = 0.0, val salesMonth: Double = 0.0, val purchasesMonth: Double = 0.0,
)
@Serializable data class ReportsResp(val data: ReportsDto)

@Serializable data class OrderLineDto(val name: String, val qty: Double = 0.0, val unitPrice: Double = 0.0, val total: Double = 0.0)
@Serializable data class OrderDetailDto(val id: String, val number: String, val party: String, val date: String, val status: String, val total: Double = 0.0, val lines: List<OrderLineDto> = emptyList())
@Serializable data class OrderDetailResp(val data: OrderDetailDto)

@Serializable data class StmtLineDto(val code: String, val name: String, val amount: Double = 0.0)
@Serializable data class IncomeDto(val from: String, val to: String, val revenue: List<StmtLineDto> = emptyList(), val expense: List<StmtLineDto> = emptyList(), val totalRevenue: Double = 0.0, val totalExpense: Double = 0.0, val net: Double = 0.0)
@Serializable data class IncomeResp(val data: IncomeDto)
@Serializable data class BalanceDto(val asOf: String, val assets: List<StmtLineDto> = emptyList(), val liabilities: List<StmtLineDto> = emptyList(), val equity: List<StmtLineDto> = emptyList(), val totalAssets: Double = 0.0, val totalLiabilities: Double = 0.0, val totalEquity: Double = 0.0)
@Serializable data class BalanceResp(val data: BalanceDto)
@Serializable data class CashFlowDto(val from: String, val to: String, val operating: List<StmtLineDto> = emptyList(), val investing: List<StmtLineDto> = emptyList(), val financing: List<StmtLineDto> = emptyList(), val opTotal: Double = 0.0, val invTotal: Double = 0.0, val finTotal: Double = 0.0, val netChange: Double = 0.0, val cashBegin: Double = 0.0, val cashEnd: Double = 0.0)
@Serializable data class CashFlowResp(val data: CashFlowDto)

@Serializable data class PartyDto(val id: String, val code: String, val nameAr: String, val phone: String = "", val email: String = "", val address: String = "", val paymentTerms: Int = 30, val creditLimit: Double = 0.0, val balance: Double = 0.0)
@Serializable data class PartyResp(val data: PartyDto)
@Serializable data class PartySaveReq(val id: String? = null, val code: String, val nameAr: String, val phone: String? = null, val email: String? = null, val paymentTerms: Int = 30, val creditLimit: Double? = null)

@Serializable data class ReqLineDto(val name: String, val qty: Double = 0.0)
@Serializable data class ReqDetailDto(val id: String, val number: String, val date: String, val status: String, val notes: String = "", val lines: List<ReqLineDto> = emptyList())
@Serializable data class ReqDetailResp(val data: ReqDetailDto)
@Serializable data class ReqCreateLine(val itemId: String, val quantity: Double)
@Serializable data class ReqCreateReq(val date: String, val notes: String? = null, val lines: List<ReqCreateLine>)

@Serializable data class PoCreateLine(val itemId: String, val quantity: Double, val unitPrice: Double)
@Serializable data class PoCreateReq(val supplierId: String, val warehouseId: String, val date: String, val notes: String? = null, val lines: List<PoCreateLine>)

// --- Purchase receipts (إذون الاستلام) ---
@Serializable data class ReceiptLineDto(val name: String, val qty: Double = 0.0, val rejected: Double = 0.0)
@Serializable data class ReceiptDetailDto(val id: String, val number: String, val date: String, val status: String, val supplier: String = "", val poNumber: String = "", val invoiced: Boolean = false, val notes: String = "", val lines: List<ReceiptLineDto> = emptyList())
@Serializable data class ReceiptDetailResp(val data: ReceiptDetailDto)
@Serializable data class ReceivableLineDto(val itemId: String, val code: String = "", val name: String = "", val remaining: Double = 0.0)
@Serializable data class ReceivableData(val lines: List<ReceivableLineDto> = emptyList(), val defaultWarehouseId: String? = null)
@Serializable data class ReceivableResp(val data: ReceivableData)
@Serializable data class ReceiptPick(val itemId: String, val quantity: Double, val rejectedQty: Double = 0.0)
@Serializable data class ReceiptCreateReq(val purchaseOrderId: String, val date: String? = null, val picks: List<ReceiptPick>? = null)
@Serializable data class BillData(val invoiceId: String? = null)
@Serializable data class BillResp(val data: BillData)

// --- Purchase invoices (standalone create) + payment (سند صرف) ---
@Serializable data class PiCreateLine(val itemId: String, val quantity: Double, val unitPrice: Double, val discountAmount: Double = 0.0, val taxAmount: Double = 0.0)
@Serializable data class PiCreateReq(val supplierId: String, val warehouseId: String, val date: String, val notes: String? = null, val lines: List<PiCreateLine>)
@Serializable data class PayableDto(val id: String, val number: String, val supplierId: String, val total: Double = 0.0, val paid: Double = 0.0, val balanceDue: Double = 0.0, val status: String)
@Serializable data class PayableResp(val data: PayableDto)
@Serializable data class PayReq(val supplierId: String, val purchaseInvoiceId: String? = null, val cashAccountId: String, val amount: Double, val date: String, val paymentMethod: String = "CASH")

// --- Accounting: journal, expenses, banks ---
@Serializable data class JournalLineDto(val account: String, val debit: Double = 0.0, val credit: Double = 0.0, val desc: String = "")
@Serializable data class JournalDetailDto(val id: String, val number: String, val date: String, val status: String, val description: String = "", val totalDebit: Double = 0.0, val totalCredit: Double = 0.0, val lines: List<JournalLineDto> = emptyList())
@Serializable data class JournalDetailResp(val data: JournalDetailDto)
@Serializable data class JeCreateLine(val accountId: String, val debit: Double = 0.0, val credit: Double = 0.0, val description: String? = null)
@Serializable data class JeCreateReq(val date: String, val description: String, val reference: String? = null, val mode: String = "draft", val lines: List<JeCreateLine>)

@Serializable data class ExpenseDetailDto(val id: String, val number: String, val date: String, val status: String, val account: String = "", val cashAccount: String = "", val amount: Double = 0.0, val payee: String = "", val notes: String = "")
@Serializable data class ExpenseDetailResp(val data: ExpenseDetailDto)
@Serializable data class ExpenseCreateReq(val expenseAccountId: String, val cashAccountId: String, val amount: Double, val date: String, val paymentMethod: String = "CASH", val payee: String? = null, val notes: String? = null)

@Serializable data class BankSaveReq(val id: String? = null, val nameAr: String, val bankName: String? = null, val accountNumber: String? = null, val iban: String? = null, val glAccountId: String? = null, val notes: String? = null)

// --- Sales revenue cycle (SO create, SI create/post, سند قبض) ---
@Serializable data class SoCreateLine(val itemId: String, val warehouseId: String? = null, val quantity: Double, val unitPrice: Double)
@Serializable data class SoCreateReq(val customerId: String, val date: String, val notes: String? = null, val lines: List<SoCreateLine>)
@Serializable data class SiCreateLine(val itemId: String, val quantity: Double, val unitPrice: Double)
@Serializable data class SiCreateReq(val customerId: String, val date: String, val notes: String? = null, val lines: List<SiCreateLine>)
@Serializable data class ReceivableDto(val id: String, val number: String, val customerId: String, val total: Double = 0.0, val paid: Double = 0.0, val balanceDue: Double = 0.0, val status: String)
@Serializable data class ReceivableInvResp(val data: ReceivableDto)
@Serializable data class CollectReq(val customerId: String, val salesInvoiceId: String? = null, val cashAccountId: String, val amount: Double, val date: String, val paymentMethod: String = "CASH")

// --- Item CRUD (الأصناف) ---
@Serializable data class ItemCodeIn(val codeType: String, val code: String)
@Serializable data class ItemEditDto(val id: String, val code: String, val nameAr: String, val nameEn: String = "", val sellPrice: Double = 0.0, val minStock: Double = 0.0, val isPerishable: Boolean = false, val codes: List<ItemCodeIn> = emptyList())
@Serializable data class ItemEditResp(val data: ItemEditDto)
@Serializable data class ItemSaveReq(val id: String? = null, val code: String, val nameAr: String, val nameEn: String? = null, val sellPrice: Double = 0.0, val minStock: Double = 0.0, val isPerishable: Boolean = false, val codes: List<ItemCodeIn> = emptyList())

// --- Stock transfers (تحويلات المخزون) ---
@Serializable data class TransferLineDto(val name: String, val qty: Double = 0.0, val from: String = "", val to: String = "")
@Serializable data class TransferDetailDto(val id: String, val number: String, val date: String, val status: String, val notes: String = "", val lines: List<TransferLineDto> = emptyList())
@Serializable data class TransferDetailResp(val data: TransferDetailDto)
@Serializable data class TfCreateLine(val itemId: String, val fromWarehouseId: String, val toWarehouseId: String, val quantity: Double)
@Serializable data class TfCreateReq(val date: String, val notes: String? = null, val lines: List<TfCreateLine>)

// --- Sales quotations (عروض الأسعار) ---
@Serializable data class QuoteCreateLine(val itemId: String, val quantity: Double, val unitPrice: Double)
@Serializable data class QuoteCreateReq(val customerId: String, val date: String, val validUntil: String? = null, val notes: String? = null, val lines: List<QuoteCreateLine>)
@Serializable data class StatusReq(val status: String)

// --- Payroll runs (مسيّرات الرواتب) ---
@Serializable data class PayrollLineDto(val name: String, val basic: Double = 0.0, val allowances: Double = 0.0, val gross: Double = 0.0, val deductions: Double = 0.0, val tax: Double = 0.0, val net: Double = 0.0)
@Serializable data class PayrollDetailDto(val id: String, val number: String, val from: String, val to: String, val status: String, val totalGross: Double = 0.0, val totalNet: Double = 0.0, val lines: List<PayrollLineDto> = emptyList())
@Serializable data class PayrollDetailResp(val data: PayrollDetailDto)
@Serializable data class PayrollCreateReq(val periodStart: String, val periodEnd: String, val paymentDate: String? = null, val notes: String? = null)
@Serializable data class ReasonReq(val reason: String)

// --- Recurring expenses (المصروفات الدورية) ---
@Serializable data class RecurExpDetailDto(val id: String, val account: String = "", val cashAccount: String = "", val amount: Double = 0.0, val frequency: String = "", val nextRunDate: String = "", val payee: String = "", val notes: String = "", val isActive: Boolean = true)
@Serializable data class RecurExpDetailResp(val data: RecurExpDetailDto)
@Serializable data class RecurExpSaveReq(val id: String? = null, val expenseAccountId: String, val cashAccountId: String, val amount: Double, val frequency: String, val nextRunDate: String, val paymentMethod: String = "CASH", val payee: String? = null, val notes: String? = null)

// --- Cost centers (مراكز التكلفة) ---
@Serializable data class CostCenterEditDto(val id: String, val code: String, val nameAr: String, val nameEn: String = "", val isActive: Boolean = true)
@Serializable data class CostCenterEditResp(val data: CostCenterEditDto)
@Serializable data class CostCenterSaveReq(val id: String? = null, val code: String, val nameAr: String, val nameEn: String? = null, val isActive: Boolean = true)

// --- Bank reconciliation (المطابقة البنكية) ---
@Serializable data class StatementLineDto(val id: String, val date: String, val description: String = "", val reference: String = "", val debit: Double = 0.0, val credit: Double = 0.0, val reconciled: Boolean = false)
@Serializable data class BankStatementDto(val bankAccountId: String, val bankName: String, val reconciledCount: Int = 0, val unreconciledCount: Int = 0, val statementBalance: Double = 0.0, val lines: List<StatementLineDto> = emptyList())
@Serializable data class BankStatementResp(val data: BankStatementDto)
@Serializable data class StatementLineReq(val date: String, val description: String? = null, val reference: String? = null, val debit: Double = 0.0, val credit: Double = 0.0)

// --- Bundles (الحزم والمجموعات) ---
@Serializable data class BundleComponentDto(val itemId: String, val name: String = "", val code: String = "", val qty: Double = 0.0)
@Serializable data class BundleDetailDto(val id: String, val code: String, val name: String, val components: List<BundleComponentDto> = emptyList())
@Serializable data class BundleDetailResp(val data: BundleDetailDto)
@Serializable data class BomComponent(val componentItemId: String, val quantity: Double)
@Serializable data class BomReq(val parentItemId: String, val components: List<BomComponent>)
@Serializable data class AssembleReq(val kitItemId: String, val warehouseId: String, val quantity: Double, val date: String, val notes: String? = null)

// --- HR: employees + leave requests ---
@Serializable data class EmployeeEditDto(val id: String, val fullName: String = "", val employeeCode: String = "", val position: String = "", val department: String = "", val payType: String = "MONTHLY", val basicSalary: Double = 0.0, val allowances: Double = 0.0, val deductions: Double = 0.0, val taxRate: Double = 0.0)
@Serializable data class EmployeeEditResp(val data: EmployeeEditDto)
@Serializable data class EmployeeSaveReq(val id: String? = null, val fullName: String, val employeeCode: String? = null, val position: String? = null, val department: String? = null, val payType: String = "MONTHLY", val basicSalary: Double = 0.0, val allowances: Double = 0.0, val deductions: Double = 0.0, val taxRate: Double = 0.0)
@Serializable data class LeaveCreateReq(val employeeId: String, val leaveType: String, val startDate: String, val endDate: String, val reason: String? = null)

// --- Recurring sales invoices (الفواتير الدورية) ---
@Serializable data class RecurLine(val itemId: String, val quantity: Double, val unitPrice: Double)
@Serializable data class RecurSaveReq(val id: String? = null, val customerId: String, val frequency: String, val nextRunDate: String, val notes: String? = null, val lines: List<RecurLine>)

// --- Stock adjustment document (تسويات المخزون) ---
@Serializable data class AdjLineDto(val name: String, val mode: String = "set", val entered: Double = 0.0, val delta: Double = 0.0, val warehouse: String = "")
@Serializable data class AdjDetailDto(val id: String, val number: String, val date: String, val status: String, val reason: String = "", val lines: List<AdjLineDto> = emptyList())
@Serializable data class AdjDetailResp(val data: AdjDetailDto)
@Serializable data class AdjDraftLine(val itemId: String, val warehouseId: String, val mode: String = "set", val value: Double)
@Serializable data class AdjDraftReq(val date: String, val reason: String? = null, val lines: List<AdjDraftLine>)

// --- Fixed assets (الأصول الثابتة) ---
@Serializable data class AssetDetailDto(val id: String, val code: String, val nameAr: String, val category: String = "OTHER", val purchaseDate: String = "", val purchaseCost: Double = 0.0, val salvageValue: Double = 0.0, val usefulLifeYears: Int = 0, val accumulated: Double = 0.0, val netBookValue: Double = 0.0, val status: String = "ACTIVE", val notes: String = "")
@Serializable data class AssetDetailResp(val data: AssetDetailDto)
@Serializable data class AssetCreateReq(val code: String, val nameAr: String, val category: String, val purchaseDate: String, val purchaseCost: Double, val salvageValue: Double = 0.0, val usefulLifeYears: Int, val notes: String? = null)

// --- Ranked reports (تقارير المبيعات/المشتريات) ---
@Serializable data class RankRowDto(val name: String, val code: String = "", val count: Int = 0, val qty: Double = 0.0, val amount: Double = 0.0)
@Serializable data class RankReportDto(val from: String, val to: String, val total: Double = 0.0, val rows: List<RankRowDto> = emptyList())
@Serializable data class RankReportResp(val data: RankReportDto)

interface Api {
    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginReq): LoginResp

    @GET("api/v1/dashboard")
    suspend fun dashboard(): DashboardResp

    @GET("api/v1/reports")
    suspend fun reports(): ReportsResp

    /** Generic list GET for any /api/v1/... path. */
    @GET
    suspend fun docList(@Url url: String): DocListResp

    /** Generic document detail GET. */
    @GET
    suspend fun orderDetail(@Url url: String): OrderDetailResp

    /** Generic action POST (no body) — e.g. confirm. */
    @POST
    suspend fun postAction(@Url url: String): OkResp

    /** Party (supplier/customer) detail for the edit form. */
    @GET
    suspend fun partyDetail(@Url url: String): PartyResp

    /** Create/update a party (JSON body). */
    @POST
    suspend fun partySave(@Url url: String, @Body body: PartySaveReq): OkResp

    @GET
    suspend fun reqDetail(@Url url: String): ReqDetailResp

    @POST
    suspend fun reqCreate(@Url url: String, @Body body: ReqCreateReq): OkResp

    @POST
    suspend fun poCreate(@Url url: String, @Body body: PoCreateReq): OkResp

    @GET
    suspend fun receiptDetail(@Url url: String): ReceiptDetailResp

    @GET
    suspend fun receivable(@Url url: String): ReceivableResp

    @POST
    suspend fun receiptCreate(@Url url: String, @Body body: ReceiptCreateReq): OkResp

    @POST
    suspend fun receiptBill(@Url url: String): BillResp

    @POST
    suspend fun piCreate(@Url url: String, @Body body: PiCreateReq): OkResp

    @GET
    suspend fun payable(@Url url: String): PayableResp

    @POST
    suspend fun pay(@Url url: String, @Body body: PayReq): OkResp

    @GET
    suspend fun jeDetail(@Url url: String): JournalDetailResp

    @POST
    suspend fun jeCreate(@Url url: String, @Body body: JeCreateReq): OkResp

    @GET
    suspend fun expenseDetail(@Url url: String): ExpenseDetailResp

    @POST
    suspend fun expenseCreate(@Url url: String, @Body body: ExpenseCreateReq): OkResp

    @POST
    suspend fun bankSave(@Url url: String, @Body body: BankSaveReq): OkResp

    @POST
    suspend fun soCreate(@Url url: String, @Body body: SoCreateReq): OkResp

    @POST
    suspend fun siCreate(@Url url: String, @Body body: SiCreateReq): OkResp

    @GET
    suspend fun invReceivable(@Url url: String): ReceivableInvResp

    @POST
    suspend fun collect(@Url url: String, @Body body: CollectReq): OkResp

    @GET
    suspend fun itemEdit(@Url url: String): ItemEditResp

    @POST
    suspend fun itemSave(@Url url: String, @Body body: ItemSaveReq): OkResp

    @GET
    suspend fun transferDetail(@Url url: String): TransferDetailResp

    @POST
    suspend fun tfCreate(@Url url: String, @Body body: TfCreateReq): OkResp

    @POST
    suspend fun quoteCreate(@Url url: String, @Body body: QuoteCreateReq): OkResp

    @POST
    suspend fun quoteStatus(@Url url: String, @Body body: StatusReq): OkResp

    @GET
    suspend fun rankReport(@Url url: String): RankReportResp

    @GET
    suspend fun payrollDetail(@Url url: String): PayrollDetailResp

    @POST
    suspend fun payrollCreate(@Url url: String, @Body body: PayrollCreateReq): OkResp

    @POST
    suspend fun payrollReverse(@Url url: String, @Body body: ReasonReq): OkResp

    @GET
    suspend fun recurExpDetail(@Url url: String): RecurExpDetailResp

    @POST
    suspend fun recurExpSave(@Url url: String, @Body body: RecurExpSaveReq): OkResp

    @GET
    suspend fun costCenterEdit(@Url url: String): CostCenterEditResp

    @POST
    suspend fun costCenterSave(@Url url: String, @Body body: CostCenterSaveReq): OkResp

    @GET
    suspend fun bankStatement(@Url url: String): BankStatementResp

    @POST
    suspend fun statementLineAdd(@Url url: String, @Body body: StatementLineReq): OkResp

    @GET
    suspend fun bundleDetail(@Url url: String): BundleDetailResp

    @POST
    suspend fun bomSave(@Url url: String, @Body body: BomReq): OkResp

    @POST
    suspend fun assemble(@Url url: String, @Body body: AssembleReq): OkResp

    @GET
    suspend fun employeeEdit(@Url url: String): EmployeeEditResp

    @POST
    suspend fun employeeSave(@Url url: String, @Body body: EmployeeSaveReq): OkResp

    @POST
    suspend fun leaveCreate(@Url url: String, @Body body: LeaveCreateReq): OkResp

    @POST
    suspend fun recurSave(@Url url: String, @Body body: RecurSaveReq): OkResp

    @GET
    suspend fun adjDetail(@Url url: String): AdjDetailResp

    @POST
    suspend fun adjDraft(@Url url: String, @Body body: AdjDraftReq): OkResp

    @GET
    suspend fun assetDetail(@Url url: String): AssetDetailResp

    @POST
    suspend fun assetCreate(@Url url: String, @Body body: AssetCreateReq): OkResp

    @GET("api/v1/financials/income")
    suspend fun incomeStatement(): IncomeResp

    @GET("api/v1/financials/balance-sheet")
    suspend fun balanceSheet(): BalanceResp

    @GET("api/v1/financials/cash-flow")
    suspend fun cashFlow(): CashFlowResp

    @GET("api/v1/inventory/items")
    suspend fun search(@Query("q") q: String): ItemsResp

    @GET("api/v1/inventory/scan")
    suspend fun scan(@Query("code") code: String): ItemResp

    @GET("api/v1/inventory/warehouses")
    suspend fun warehouses(): WarehousesResp

    @POST("api/v1/inventory/adjustments")
    suspend fun adjust(@Body body: AdjustReq): OkResp
}
