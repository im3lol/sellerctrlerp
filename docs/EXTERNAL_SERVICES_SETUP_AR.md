# تجهيز خدمات التشغيل الخارجية

هذا الدليل يجهّز الخدمات المحيطة بالإنتاج. لا تضع أي مفتاح في Git أو في رسالة؛ أدخله في ملف `.env` على جهاز الإنتاج فقط، ثم انشر بـ `npm run deploy`.

## 1. البريد التشغيلي (SMTP)

البريد مطلوب لدعوات المستخدمين، استعادة كلمة المرور، والإشعارات. الأسهل هو إدخاله من **لوحة الإدارة ← التكاملات**؛ كلمة المرور تحفظ مشفّرة ولا تظهر مجددًا.

بيانات مطلوبة من مزود البريد: `SMTP_HOST` و`SMTP_PORT` و`SMTP_USER` و`SMTP_PASS` و`SMTP_FROM`. استخدم منفذ `587` لـ STARTTLS أو `465` لـ SSL. بعد الحفظ أرسل رسالة اختبار إلى بريد تملكه من صفحة التكاملات.

## 2. Sentry لمراقبة الأخطاء

1. أنشئ مشروع **Next.js** باسم `sellerctrl-production` في [Sentry](https://sentry.io/).
2. انسخ DSN فقط إلى `SENTRY_DSN` في `.env`.
3. انشر النظام. لا تحتاج DSN في المتصفح.
4. راقب أول خطأ في المشروع وتأكد من وصول التنبيه لفريق التشغيل.

النظام يرسل أخطاء الخادم المنظمة فقط، ويزيل الحقول التي تبدو ككلمات مرور أو مفاتيح أو cookies قبل الإرسال. لا يوقف Sentry أي طلب إذا تعطلت خدمته.

## 3. تنبيه خارجي عند التوقف

أنشئ فحص HTTP في UptimeRobot أو Healthchecks.io للرابط:

`https://app.sellerctrl.com/api/health`

اضبطه كل 5 دقائق، والنجاح هو HTTP `200` مع `"ok": true`. أضف تنبيه Telegram أو بريد لفريق التشغيل. هذا الفحص ضروري لأنه يعمل خارج الجهاز؛ لذلك يكتشف انقطاع الكهرباء أو الإنترنت أو Docker نفسه.

## 4. النسخة الاحتياطية خارج الجهاز (Cloudflare R2 / S3)

أنشئ bucket خاصًا، مثل `sellerctrl-production-backups`، ومفتاحًا له صلاحية قراءة/كتابة لهذا الـbucket فقط. أضف إلى `.env`:

```dotenv
OFFSITE_S3_BUCKET=sellerctrl-production-backups
OFFSITE_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<key-id>
AWS_SECRET_ACCESS_KEY=<secret>
```

بعد النشر، خدمة `sellerctrl-backup` ترفع كل `pg_dump` تلقائيًا. تحقق من `docker logs --tail 20 sellerctrl-backup`: المطلوب ظهور `[backup] offsite ok`. نفّذ تجربة الاستعادة شهريًا بـ `bash scripts/restore-drill.sh`.

## 5. فحص الجاهزية

بعد الإعداد شغّل:

```bash
npm run ops:external:check -- --strict
```

لا يطبع الأمر أي قيمة سرية. افحص أيضًا SMTP من لوحة الإدارة لأن إعداد SMTP قد يكون مخزنًا مشفرًا في قاعدة البيانات وليس في `.env`.
