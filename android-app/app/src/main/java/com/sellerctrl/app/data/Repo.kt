package com.sellerctrl.app.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.create
import java.util.concurrent.TimeUnit

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

    // --- Live sync (SSE) ---------------------------------------------------
    // `tick` bumps on every server-pushed change event; screens key their reload
    // on it to refetch live. Mirrors the web's LiveRefresh via /api/v1/stream.
    private val _tick = MutableStateFlow(0L)
    val tick: StateFlow<Long> = _tick
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val sseClient = client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).retryOnConnectionFailure(true).build()
    @Volatile private var eventSource: EventSource? = null

    fun startRealtime() {
        if (!isLoggedIn() || eventSource != null) return
        connectSse()
    }

    private fun connectSse() {
        val req = Request.Builder().url(BASE_URL + "api/v1/stream").build() // interceptor adds auth headers
        eventSource = EventSources.createFactory(sseClient).newEventSource(req, object : EventSourceListener() {
            override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
                if (!data.contains("\"HELLO\"")) _tick.value = _tick.value + 1
            }
            override fun onFailure(es: EventSource, t: Throwable?, response: okhttp3.Response?) {
                eventSource = null
                // Reconnect while logged in (backoff 3s).
                scope.launch { delay(3000); if (isLoggedIn()) connectSse() }
            }
        })
    }

    fun stopRealtime() {
        eventSource?.cancel()
        eventSource = null
    }

    suspend fun login(username: String, password: String): LoginResp {
        val r = api.login(LoginReq(username.trim(), password))
        val org = r.orgs.firstOrNull()
        store.save(r.token, org?.id ?: "", org?.name ?: "", r.user.name)
        startRealtime()
        return r
    }

    suspend fun search(q: String): List<ItemDto> = api.search(q).data
    suspend fun scan(code: String): ItemDto = api.scan(code).data
    suspend fun warehouses(): List<WarehouseDto> = api.warehouses().data
    suspend fun dashboard(): DashboardDto = api.dashboard().data
    suspend fun reports(): ReportsDto = api.reports().data
    suspend fun docList(path: String): List<DocRow> = api.docList(path).data
    suspend fun orderDetail(path: String): OrderDetailDto = api.orderDetail(path).data
    suspend fun incomeStatement(): IncomeDto = api.incomeStatement().data
    suspend fun balanceSheet(): BalanceDto = api.balanceSheet().data
    suspend fun cashFlow(): CashFlowDto = api.cashFlow().data

    suspend fun partyDetail(type: String, id: String): PartyDto = api.partyDetail("api/v1/party/$type/$id").data
    /** Create/update a party; throws the server's Arabic error on failure. */
    suspend fun partySave(type: String, req: PartySaveReq) {
        try { api.partySave("api/v1/party/$type/save", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }
    suspend fun partyDelete(type: String, id: String) = postAction("api/v1/party/$type/$id/delete")

    suspend fun requisitionDetail(id: String): ReqDetailDto = api.reqDetail("api/v1/purchases/requisitions/$id").data
    /** Create a material requisition; throws the server's Arabic error on failure. */
    suspend fun requisitionCreate(req: ReqCreateReq) {
        try { api.reqCreate("api/v1/purchases/requisitions", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }
    /** Create a purchase order; throws the server's Arabic error on failure. */
    suspend fun purchaseOrderCreate(req: PoCreateReq) {
        try { api.poCreate("api/v1/purchases/orders", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }

    // --- Purchase receipts (إذون الاستلام) ---
    suspend fun receiptDetail(id: String): ReceiptDetailDto = api.receiptDetail("api/v1/purchases/receipts/$id").data
    /** Confirmed/partial POs to receive against (for the receipt form). */
    suspend fun receivableOrders(): List<DocRow> = api.docList("api/v1/purchases/receivable-orders").data
    /** A PO's still-unreceived lines. */
    suspend fun receivableLines(poId: String): ReceivableData = api.receivable("api/v1/purchases/orders/$poId/receivable").data
    /** Create a DRAFT goods receipt from a PO; throws the server's Arabic error on failure. */
    suspend fun receiptCreate(req: ReceiptCreateReq) {
        try { api.receiptCreate("api/v1/purchases/receipts", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }
    /** Bill a confirmed receipt → DRAFT purchase invoice; returns the new invoice id. */
    suspend fun receiptBill(id: String): String? {
        try { return api.receiptBill("api/v1/purchases/receipts/$id/bill").data.invoiceId }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الفوترة") }
    }

    // --- Purchase invoices (standalone) + payment (سند صرف) ---
    /** Create a standalone DRAFT purchase invoice; throws the server's Arabic error on failure. */
    suspend fun purchaseInvoiceCreate(req: PiCreateReq) {
        try { api.piCreate("api/v1/purchases/invoices", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }
    suspend fun invoicePayable(id: String): PayableDto = api.payable("api/v1/purchases/invoices/$id/payable").data
    /** Cash/bank leaf accounts for the payment picker. */
    suspend fun cashAccounts(): List<DocRow> = api.docList("api/v1/accounting/cash-accounts").data
    /** Create + post a supplier payment voucher; throws the server's Arabic error on failure. */
    suspend fun payInvoice(req: PayReq) {
        try { api.pay("api/v1/purchases/payments", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الدفع") }
    }

    // --- Accounting: journal, expenses, banks ---
    /** Postable leaf accounts for pickers (optionally by type: EXPENSE/ASSET/…). */
    suspend fun accounts(type: String? = null): List<DocRow> =
        api.docList("api/v1/accounting/accounts" + (if (type != null) "?type=$type" else "")).data
    suspend fun journalDetail(id: String): JournalDetailDto = api.jeDetail("api/v1/accounting/journal/$id").data
    suspend fun journalCreate(req: JeCreateReq) {
        try { api.jeCreate("api/v1/accounting/journal", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }
    suspend fun expenseDetail(id: String): ExpenseDetailDto = api.expenseDetail("api/v1/accounting/expenses/$id").data
    suspend fun expenseCreate(req: ExpenseCreateReq) {
        try { api.expenseCreate("api/v1/accounting/expenses", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }
    suspend fun bankSave(req: BankSaveReq) {
        try { api.bankSave("api/v1/accounting/banks", req) }
        catch (e: retrofit2.HttpException) { throw Exception(parseErr(e) ?: "تعذّر الحفظ") }
    }

    private fun parseErr(e: retrofit2.HttpException): String? =
        e.response()?.errorBody()?.string()?.let { runCatching { json.decodeFromString<OkResp>(it).error }.getOrNull() }

    /** POST an action (e.g. confirm); throws the server's Arabic error on failure. */
    suspend fun postAction(path: String) {
        try {
            api.postAction(path)
        } catch (e: retrofit2.HttpException) {
            val msg = e.response()?.errorBody()?.string()
                ?.let { runCatching { json.decodeFromString<OkResp>(it).error }.getOrNull() }
            throw Exception(msg ?: "فشل التنفيذ")
        }
    }

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

    suspend fun logout() { stopRealtime(); store.clear() }

    companion object {
        // Local test build: talks to the Docker app via `adb reverse tcp:3001`.
        // For production, switch to "https://www.sellerctrl.com/".
        const val BASE_URL = "http://localhost:3001/"
    }
}
