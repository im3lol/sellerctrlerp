package com.sellerctrl.app.data

import okhttp3.Interceptor
import okhttp3.Response

/** Adds the bearer token + active-org header to every request. */
class AuthInterceptor(private val store: TokenStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val b = chain.request().newBuilder()
        store.token?.takeIf { it.isNotEmpty() }?.let { b.header("Authorization", "Bearer $it") }
        store.orgId?.takeIf { it.isNotEmpty() }?.let { b.header("X-Org-Id", it) }
        return chain.proceed(b.build())
    }
}
