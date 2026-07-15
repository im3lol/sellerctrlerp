package com.sellerctrl.app.data

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.create

class Repo(val store: TokenStore) {
    private val json = Json { ignoreUnknownKeys = true }
    private val client = OkHttpClient.Builder()
        .addInterceptor(AuthInterceptor(store))
        .build()
    private val api: Api = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create()

    fun isLoggedIn(): Boolean = !store.token.isNullOrEmpty()
    fun orgName(): String = store.orgName ?: ""
    fun userName(): String = store.userName ?: ""

    suspend fun login(username: String, password: String): LoginResp {
        val r = api.login(LoginReq(username.trim(), password))
        val org = r.orgs.firstOrNull()
        store.save(r.token, org?.id ?: "", org?.name ?: "", r.user.name)
        return r
    }

    suspend fun search(q: String): List<ItemDto> = api.search(q).data
    suspend fun scan(code: String): ItemDto = api.scan(code).data
    suspend fun warehouses(): List<WarehouseDto> = api.warehouses().data
    suspend fun dashboard(): DashboardDto = api.dashboard().data
    suspend fun docList(path: String): List<DocRow> = api.docList(path).data

    /** One-shot stock count: create + post an adjustment. Throws the server's
     *  Arabic error message on failure. */
    suspend fun submitCount(warehouseId: String, reason: String, lines: List<CountLine>) {
        try {
            api.adjust(AdjustReq(warehouseId, reason.ifBlank { null }, lines))
        } catch (e: retrofit2.HttpException) {
            val msg = e.response()?.errorBody()?.string()
                ?.let { runCatching { json.decodeFromString<OkResp>(it).error }.getOrNull() }
            throw Exception(msg ?: "فشل حفظ الجرد")
        }
    }

    suspend fun logout() = store.clear()

    companion object {
        // Local test build: talks to the Docker app via `adb reverse tcp:3001`.
        // For production, switch to "https://www.sellerctrl.com/".
        const val BASE_URL = "http://localhost:3001/"
    }
}
