package com.sellerctrl.app

import android.content.Context
import com.sellerctrl.app.data.Repo
import com.sellerctrl.app.data.TokenStore

/** Tiny manual DI — one Repo for the whole app (no Hilt to keep the build lean). */
object ServiceLocator {
    lateinit var repo: Repo
        private set

    fun init(context: Context) {
        repo = Repo(TokenStore(context.applicationContext))
    }
}
