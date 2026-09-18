# أمازون: «أعد الربط» / 401 / invalid_grant

كل شركة ليها توكن SP-API متشفّر في `platform_credentials`. لما أمازون يرفضه (`invalid_grant`)، النظام بيعلّم `needs_reauth = true` والجدولة بتقف عن الشركة دي، عشان مايعملش طلبات فاشلة.

## التأكد

- صفحة المنصة بتقول «أعد الربط»، أو «صحة أمازون» فيها «مزامنات واقفة».
- `select needs_reauth, last_sync_status, last_sync_at from platform_credentials where provider='amazon';`

## الحل

1. صاحب الشركة يفتح **المنصات ← أمازون ← ربط أمازون**، ويوافق في Seller Central بنفس حساب البائع.
2. الرجوع بيحصل على `/api/erp/marketplace/amazon/callback`، واتأكد منه بتوقيع الـstate. التوكن الجديد بيتخزّن، و`needs_reauth` بيرجع false.
3. المزامنة بتكمّل من آخر علامة (`orders_synced_at` …) من غير ما تكرّر حاجة.

## أسباب شائعة

- البائع شال التطبيق من Seller Central، أو غيّر الباسورد مع «تسجيل الخروج من كل التطبيقات».
- التطبيق نفسه اتغيّرت بياناته (`SPAPI_*` في `.env`) → كل الشركات محتاجة تعيد الربط. **ماتغيّرش `ENCRYPTION_KEY`**، وإلا كل التوكنات المتخزّنة بتبوظ.
- Callback URL مش مطابق للي في Developer Central (مثلًا بعد ما الدومين اتغيّر).
