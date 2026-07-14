# SellerCtrl — تطبيق أندرويد (Capacitor)

غلاف native رفيع يفتح تطبيق الويب الحي (`https://sellerctrl.com`) في WebView، ويضيف
**ماسح باركود native** (ML Kit). التطبيق = «نفس الموقع» — أي تحديث للويب يظهر فورًا
بدون إعادة بناء الـAPK. الجلسة (كوكي JWT) بتثبت في الـWebView فالمستخدم بيفضل مسجّل دخول.

## المتطلبات
- **Android Studio** (يجيب Android SDK + JDK 21 المطلوب لـCapacitor 8).
- Node 18+.

## أول إعداد (مرة واحدة)
```bash
cd mobile
npm install
npx cap add android      # يولّد مجلد android/ (native project — مش مرفوع على git)
npm run assets           # يولّد أيقونة التطبيق + السبلاش من mobile/assets/ لكل الكثافات
npx cap sync
```
أصول البراند جاهزة في `mobile/assets/` (`icon.png`, `icon-foreground.png`,
`icon-background.png`, `splash.png`, `splash-dark.png`). عدّلها لو حبيت وأعد `npm run assets`.

## البناء والتشغيل
```bash
npx cap open android     # يفتح المشروع في Android Studio
# من Android Studio: Run على جهاز/محاكي، أو
# Build > Generate Signed Bundle / APK  → APK/AAB للنشر على Google Play
```
أو من سطر الأوامر بعد `cap sync`:
```bash
cd android && ./gradlew assembleDebug     # ينتج app/build/outputs/apk/debug/app-debug.apk
```

## أذونات الكاميرا
ماسح `@capacitor-mlkit/barcode-scanning` بيحتاج إذن الكاميرا. تأكّد إن
`android/app/src/main/AndroidManifest.xml` فيه:
```xml
<uses-permission android:name="android.permission.CAMERA" />
```
(البلجن بيضيفه غالبًا تلقائيًا عبر merge — راجعه.)

## زر المسح
زر الكاميرا بيظهر تلقائيًا جوّه التطبيق فقط (محروس بـ`window.Capacitor`) في كل مكان
فيه حقل مسح الباركود — إضافات/تحويلات المخزون وأوامر الشراء (`components/erp/barcode-scan.tsx`).
بيفتح الكاميرا → ياخد الكود → يطابقه بأصنافك (`scanItemAction`) → يضيف السطر. في المتصفح
العادي الزر مايظهرش.

## اختبار محلي (اختياري)
لتجربة التطبيق على build تطوير قبل النشر، غيّر `server.url` في
[capacitor.config.ts](capacitor.config.ts) لرابط الـpreview (أو IP جهازك على شبكة محلية)
ثم `npx cap sync` وأعد التشغيل.

## النشر
1. جهّز مفتاح توقيع (keystore) من Android Studio.
2. Build > Generate Signed Bundle (AAB) → ارفعه على Google Play Console.
3. `appId` الحالي: `com.sellerctrl.app` (غيّره في [capacitor.config.ts](capacitor.config.ts) لو محتاج).
