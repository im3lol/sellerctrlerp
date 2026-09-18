# المزامنة واقفة / الطوابير / الـworker

الـworker = كونتينر `sellerctrl-worker` (BullMQ على Redis). الطوابير في `lib/queue/queues.ts`: أمازون (orders, settlements, inventory, returns, removals, reimbursements, ledger, offers, …) + `automation` + `maintenance`.

## التأكد

- `docker inspect -f '{{.State.Health.Status}}' sellerctrl-worker` → `healthy`. الـhealth بيطلب نبض أحدث من دقيقتين.
- صفحة **صحة أمازون** (`/platforms/amazon/health`) ← «مزامنات واقفة»: كل نوع مزامنة آخر محاولة ليه فشلت.
- آخر المحاولات بسببها: جدول `sync_runs` (`status`, `error`, `started_at` — بتوقيت UTC).
- اللوجات: `docker logs --since 30m sellerctrl-worker`.

## الحل حسب السبب

| الخطأ في `sync_runs.error` | المعنى | الحل |
|---|---|---|
| `fetch failed` مرة وبعدين `OK` | نت متقطّع | ولا حاجة — المزامنة بتكمّل من آخر علامة |
| «أعد الربط» / `invalid_grant` | التوكن اتلغى | [amazon-oauth.md](amazon-oauth.md) |
| `QuotaExceeded` / 429 | حصة أمازون خلصت | استنى — الجدولة بتبطّأ لوحدها. ماتضغطش «مزامنة الآن» كتير |
| «توقّف بإعادة تشغيل الخادم» | نشر أو ريستارت في نص التشغيل | ولا حاجة — المحاولة الجاية بتعيد نفس النافذة |

- **الـworker مش healthy**: `docker restart sellerctrl-worker`. لو رجع unhealthy، راجع Redis: `docker exec sellerctrl-redis redis-cli ping`.
- **إعادة مزامنة آمنة**: الاستيراد idempotent بالـ(org, channel, externalId)، يعني إعادة نفس الفترة مابتكرّرش طلبات. «مزامنة الآن» من صفحة أمازون.
- **تحقق شامل بعد أي مشكلة**: `scripts/checks/chk-amazon-recon.ts` بيتأكد إن القيود = المخزون = التسويات.
