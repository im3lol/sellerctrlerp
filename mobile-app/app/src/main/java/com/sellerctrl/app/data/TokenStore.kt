package com.sellerctrl.app.data

import com.sellerctrl.app.tr

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/**
 * Keeps the mobile access token encrypted at rest. The AES key never leaves the
 * Android Keystore; preferences only contain IV + ciphertext. A device restore,
 * key invalidation or corrupt value fails closed and requires signing in again.
 */
class TokenStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Volatile var token: String? = null; private set
    @Volatile var orgId: String? = null; private set
    @Volatile var orgName: String? = null; private set
    @Volatile var userName: String? = null; private set

    init { load() }

    private fun load() {
        token = decrypt(prefs.getString(K_TOKEN, null))
        orgId = decrypt(prefs.getString(K_ORG, null))
        orgName = decrypt(prefs.getString(K_ORG_NAME, null))
        userName = decrypt(prefs.getString(K_USER, null))
        // A partial or invalid session must never produce authenticated requests.
        if (token.isNullOrBlank() || orgId.isNullOrBlank()) clearSync()
    }

    suspend fun save(token: String, orgId: String, orgName: String, userName: String) {
        val values = mapOf(K_TOKEN to token, K_ORG to orgId, K_ORG_NAME to orgName, K_USER to userName)
        val editor = prefs.edit()
        try {
            values.forEach { (key, value) -> editor.putString(key, encrypt(value)) }
            editor.commit()
            this.token = token; this.orgId = orgId; this.orgName = orgName; this.userName = userName
        } catch (_: Exception) {
            editor.clear().commit()
            throw IllegalStateException(tr("تعذّر تأمين جلسة الدخول على الجهاز"))
        }
    }

    suspend fun clear() = clearSync()

    private fun clearSync() {
        prefs.edit().clear().commit()
        token = null; orgId = null; orgName = null; userName = null
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val packed = ByteBuffer.allocate(1 + iv.size + ciphertext.size)
            .put(iv.size.toByte()).put(iv).put(ciphertext).array()
        return Base64.encodeToString(packed, Base64.NO_WRAP)
    }

    private fun decrypt(packed: String?): String? {
        if (packed.isNullOrBlank()) return null
        return try {
            val raw = Base64.decode(packed, Base64.NO_WRAP)
            if (raw.isEmpty()) return null
            val ivSize = raw[0].toInt() and 0xff
            if (ivSize !in 12..16 || raw.size <= ivSize + 1) return null
            val iv = raw.copyOfRange(1, 1 + ivSize)
            val ciphertext = raw.copyOfRange(1 + ivSize, raw.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), javax.crypto.spec.GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Exception) { null }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val PREFS = "sellerctrl_secure_session"
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "sellerctrl.mobile.session.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val K_TOKEN = "token"
        const val K_ORG = "org"
        const val K_ORG_NAME = "org_name"
        const val K_USER = "user"
    }
}
