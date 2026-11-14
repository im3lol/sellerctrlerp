package com.sellerctrl.app

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        I18n.init(this)
        ServiceLocator.init(this)
    }
}
