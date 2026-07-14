package com.sellerctrl.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

private val Context.dataStore by preferencesDataStore("auth")

/** Persists the bearer token + active org, with an in-memory mirror so the OkHttp
 *  interceptor (which is synchronous) can read them without suspending. */
class TokenStore(private val context: Context) {
    @Volatile var token: String? = null; private set
    @Volatile var orgId: String? = null; private set
    @Volatile var orgName: String? = null; private set
    @Volatile var userName: String? = null; private set

    init { runBlocking { load() } }

    private suspend fun load() {
        val p = context.dataStore.data.first()
        token = p[K_TOKEN]; orgId = p[K_ORG]; orgName = p[K_ORG_NAME]; userName = p[K_USER]
    }

    suspend fun save(token: String, orgId: String, orgName: String, userName: String) {
        context.dataStore.edit { it[K_TOKEN] = token; it[K_ORG] = orgId; it[K_ORG_NAME] = orgName; it[K_USER] = userName }
        this.token = token; this.orgId = orgId; this.orgName = orgName; this.userName = userName
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
        token = null; orgId = null; orgName = null; userName = null
    }

    companion object {
        private val K_TOKEN = stringPreferencesKey("token")
        private val K_ORG = stringPreferencesKey("org")
        private val K_ORG_NAME = stringPreferencesKey("org_name")
        private val K_USER = stringPreferencesKey("user")
    }
}
