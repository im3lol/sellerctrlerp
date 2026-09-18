# الموقع مش بيفتح من برّه

الإنتاج = Docker على الجهاز ده + نفق Cloudflare. الملفات في `C:\Users\3lyge\sellerctrl-tunnel\`.

## التأكد

1. التطبيق نفسه: `curl -s localhost:3001/api/health` → لازم `200`.
   - مش شغّال؟ Docker Desktop واقف أو الكونتينرات نايمة → الخطوة «Docker» تحت.
2. النفق: `tunnel.log` و`watchdog.log` في مجلد النفق. الرابط الحالي في `current-url.txt`.

## الحل

- **Docker**: شغّله من قايمة ابدأ (مش من سكربت). بعدها:
  `cd docker && docker compose --env-file ../.env --profile app up -d`.
  `AutoStart` متفعّل، بس Docker مابيقومش غير **بعد تسجيل دخول الويندوز** — عشان كده لازم تسجيل دخول تلقائي (`netplwiz`).
- **النفق**: مهمة الجدولة «SellerCtrl Watchdog» بتشتغل كل 5 دقايق. بتصحّي المشرف (`supervise-tunnel.ps1`) لو مات، وبتشغّل Docker لو واقف، وبتبعت تليجرام.
  - تشغيل يدوي: من Task Scheduler ← «SellerCtrl Watchdog» ← Run.
  - **ماتشغّلش المشرف من نافذة terminal** بتقفلها: بيموت معاها، والموقع يطلع 1033.
- **بعد ريستارت الجهاز**: اتأكد إن `curl localhost:3001/api/health` بيرجع 200، وإن الرابط العام بيفتح.

## اللي بيكشف الوقعة

- تليجرام من الـwatchdog: التطبيق واقع، أو النفق واقع.
- **لو الجهاز نفسه وقع أو النت قطع، محدش جوّه هيبعت حاجة.** عشان كده لازم مراقبة من برّه (UptimeRobot على `/api/health`).
