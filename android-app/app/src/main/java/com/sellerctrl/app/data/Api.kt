package com.sellerctrl.app.data

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

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

interface Api {
    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginReq): LoginResp

    @GET("api/v1/inventory/items")
    suspend fun search(@Query("q") q: String): ItemsResp

    @GET("api/v1/inventory/scan")
    suspend fun scan(@Query("code") code: String): ItemResp

    @GET("api/v1/inventory/warehouses")
    suspend fun warehouses(): WarehousesResp

    @POST("api/v1/inventory/adjustments")
    suspend fun adjust(@Body body: AdjustReq): OkResp
}
