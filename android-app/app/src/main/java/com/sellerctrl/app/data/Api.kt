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

    @GET("api/v1/inventory/items")
    suspend fun search(@Query("q") q: String): ItemsResp

    @GET("api/v1/inventory/scan")
    suspend fun scan(@Query("code") code: String): ItemResp

    @GET("api/v1/inventory/warehouses")
    suspend fun warehouses(): WarehousesResp

    @POST("api/v1/inventory/adjustments")
    suspend fun adjust(@Body body: AdjustReq): OkResp
}
