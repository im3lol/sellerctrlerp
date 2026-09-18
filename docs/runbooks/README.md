# Runbooks — لما حاجة تقع

كل ملف: **العَرَض ← التأكد ← الحل**. ابدأ دايمًا بـ `curl -s localhost:3001/api/health` (داتابيز + Redis + نبض الـworker).

| الموقف | الملف |
|---|---|
| الموقع مش بيفتح من برّه / النفق | [tunnel.md](tunnel.md) |
| المزامنة واقفة، الطوابير متكدّسة، الـworker | [worker-queues.md](worker-queues.md) |
| أمازون بيقول «أعد الربط» / 401 / invalid_grant | [amazon-oauth.md](amazon-oauth.md) |
| استرجاع بيانات، الباك أب، تجربة الاستعادة | [backup-restore.md](backup-restore.md) |

الحوادث الأمنية: `docs/incident-response.md`. الأسرار: `docs/SECRET-ROTATION.md`.
