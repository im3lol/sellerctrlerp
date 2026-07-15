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
