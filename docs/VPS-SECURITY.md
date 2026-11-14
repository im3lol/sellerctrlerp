# تجهيز VPS للإنتاج

الملفات جاهزة للتطبيق على **Ubuntu 24.04 LTS جديد**. تجهيز الملفات لا يعني أنها
اتطبقت على السيرفر. يلزم IP السيرفر، مستخدم sudo، مفتاح SSH، نطاقان للتطبيق
والتخزين، IP الإدارة، وبيانات bucket خارجي خاص للنسخ الاحتياطي.

## 1. الدخول والتحديثات والجدار الناري

أنشئ مستخدم sudo غير root وثبّت مفتاحه العام في `~/.ssh/authorized_keys` بصلاحيات
700 للمجلد و600 للملف. اختبر الدخول وصلاحية sudo قبل تنفيذ أي تقييد.
احتفظ بجلسة مفتوحة وإمكانية الدخول من console مزود الـVPS.

```bash
sudo env ADMIN_CIDR=203.0.113.10/32 SSH_PORT=22 bash scripts/vps/harden.sh
```

استبدل عنوان المثال بعنوان الإدارة الحقيقي (أو شبكة VPN). السكربت يسمح بـ80 و443
للجميع وSSH لعنوان الإدارة فقط، ويفعّل تحديثات الأمان دون إعادة تشغيل تلقائي.
لو فيه قواعد UFW سابقة، يتوقف لمراجعتها بدل حذفها. كرر نفس القواعد في firewall
مزود الاستضافة، مع تغطية IPv6 أيضًا. تأكد أن `IPV6=yes` في `/etc/default/ufw`.
السكربت لا يغير بورت SSH؛ `SSH_PORT` لازم يطابق البورت الموجود بالفعل.

من جهازك افتح **جلسة جديدة** تجبر استخدام المفتاح فقط:

```bash
ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -i ~/.ssh/id_ed25519 deploy@SERVER_IP
# داخل الجلسة الجديدة، وبعد نجاح sudo:
sudo env ADMIN_CIDR=203.0.113.10/32 SSH_CLIENT_IP=203.0.113.10 bash scripts/vps/harden.sh --key-login-tested
```

المرحلة الثانية تعطل root وكلمات المرور وتتحقق من إعداد sshd الفعلي قبل reload.
الخيار إقرار بأنك اختبرت المفتاح، وليس اختبارًا آليًا للمفتاح. اختبر جلسة ثالثة
قبل إغلاق الجلسات المفتوحة. الاسترجاع من console: احذف
`/etc/ssh/sshd_config.d/00-sellerctrl.conf` ثم `sshd -t && systemctl reload ssh`.

## 2. Docker وNode والأسرار

ثبّت Docker Engine وCompose من مستودع Docker الرسمي وNode 22. عضوية مجموعة
docker تعطي صلاحيات مكافئة لـroot؛ قصرها على مسؤول النشر.
انسخ المشروع إلى مسار دائم، وشغّل `npm ci`. لا تنقل `.env` التجريبي للإنتاج،
ولا تشغّل `db:seed` على قاعدة إنتاج. على السيرفر الجديد فقط:

```bash
umask 077
npm run --silent gen:secrets > .env
chmod 600 .env
```

أضف إلى الملف (القيم أمثلة، استبدلها):

```dotenv
NODE_ENV=production
APP_DOMAIN=app.example.com
MARKETING_DOMAIN=example.com
STORAGE_DOMAIN=storage.example.com
APP_URL=https://app.example.com
MARKETING_URL=https://app.example.com
AUTH_TRUST_HOST=true
S3_ENDPOINT=https://storage.example.com
S3_PUBLIC_URL=https://storage.example.com/sellerctrl
S3_REGION=us-east-1
S3_BUCKET=sellerctrl
S3_PRIVATE_BUCKET=sellerctrl-private
REDIS_URL=redis://127.0.0.1:6380
SIGNUP_OPEN=0
COMPOSE_FILE=docker-compose.yml:docker-compose.vps.yml
OFFSITE_S3_ENDPOINT=https://YOUR-OFFSITE-ENDPOINT
OFFSITE_S3_BUCKET=YOUR-PRIVATE-BACKUP-BUCKET
AWS_ACCESS_KEY_ID=YOUR-OFFSITE-KEY
AWS_SECRET_ACCESS_KEY=YOUR-OFFSITE-SECRET
DATABASE_URL=postgres://appuser:APPUSER_PASSWORD_VALUE@127.0.0.1:5433/sellerctrl
MIGRATE_DATABASE_URL=postgres://sellerctrl:POSTGRES_PASSWORD_VALUE@127.0.0.1:5433/sellerctrl
```

استبدل كلمتي المرور بالقيم المولدة؛ لا تكتب المتغيرات كقيم حرفية. أسرار المولد
صالحة للاستخدام في URI. Compose يبدّل عناوين DB وRedis داخل الكونتينرات تلقائيًا.
لبيانات موجودة مسبقًا اتبع [ترتيب تدوير الأسرار](SECRET-ROTATION.md): تغيير
ENCRYPTION_KEY عشوائيًا يجعل التوكنات وMFA القديمة غير قابلة للفك. تغيير متغير
POSTGRES_PASSWORD لا يغير كلمة مرور قاعدة موجودة؛ يجب تدوير الدور داخل PostgreSQL.
غيّر/عطّل كل حساب تجريبي (خصوصًا `admin/password123`) قبل فتح الموقع.

## 3. HTTPS والنشر

وجّه سجلات A للنطاقين إلى الـVPS. أضف AAAA فقط لو IPv6 يعمل بنفس الحماية.
لا تشغّل reverse proxy آخر على 80/443.

```bash
sudo env APP_DOMAIN=app.example.com MARKETING_DOMAIN=example.com STORAGE_DOMAIN=storage.example.com TLS_EMAIL=ops@example.com ADMIN_CIDRS='203.0.113.10/32' bash scripts/vps/install-proxy.sh
set -a
. ./.env
set +a
cd docker
docker compose --env-file ../.env up -d postgres redis minio minio-init
cd ..
npm run env:production:check
npm run deploy
```

Caddy يصدر ويجدد شهادة مجانية ويحول HTTP إلى HTTPS. الإدارة `/admin` و
`/login/admin` و`/api/admin` مقيدة بعناوين الإدارة، مع استمرار مصادقة التطبيق.
`remote_ip` يفترض أن Caddy يستقبل الاتصال مباشرة: لا تضع CDN أمامه دون إعداد
trusted proxies والتحقق من عنوان العميل. لوحة MinIO على 9001 وAdminer على 8080
تظل داخلية؛ لا تبدأ profile tools باستمرار. منفذ S3 على نطاق التخزين عام عبر
HTTPS حتى تعمل روابط المرفقات الموقعة؛ الـprivate bucket لا يسمح بوصول مجهول.

Docker يمكن أن يتجاوز قواعد UFW للمنافذ المنشورة؛ لذلك اترك ربط الخدمات على
loopback كما هو ولا تستخدم `0.0.0.0` لها. لا تنشر Docker API على الإنترنت.

بديل خدمة Caddy على النظام: استخدم `docker compose --profile edge up -d caddy`
من مجلد docker مع VPS override وملف البيئة. يستخدم host networking على Linux
للحفاظ على عنوان العميل، مع volumes دائمة للشهادات. لا تشغّل الطريقتين معًا.
MARKETING_DOMAIN يخدم النطاق الرئيسي وwww؛ وجّه DNS لهما إلى السيرفر أيضًا.
اترك AUTH_URL غير مضبوط في هذا النشر متعدد النطاقات؛ تثبيته على app يسبب حلقة
تحويل لصفحات التسويق عند استخدامه مع proxy الحالي.

## 4. النسخ الاحتياطي والتحقق قبل الإطلاق

VPS override يستبدل backup بعملية يومية لقاعدة البيانات **ولكل من bucket الصور
والمرفقات**. النسخ الخارجية إلزامية، وأي فشل يوقف العملية ويظهر في logs وإعادة
تشغيل الكونتينر. لا تعتبر restart policy بديلًا لمراقبة الفشل. راقب عمر ملف
`/backups/last-offsite-success` (أقل من 26 ساعة) داخل backup ونبّه عند التقادم.

استثناء انتقال مؤقت: `BACKUP_REQUIRE_OFFSITE=0` يسمح بنسخ قاعدة البيانات
والملفات محليًا فقط عند غياب OFFSITE_S3_BUCKET، ويكتب `LOCAL ONLY` بوضوح.
راقب `last-backup-success` في هذا الوضع. النسخ المحلية للملفات والـdump تُحفظ
14 يومًا. بعد إعداد النسخ الخارجي احذف الاستثناء (أو اجعله 1)، ثم أعد إنشاء
كونتينر backup وتحقق من `last-offsite-success` وجرّب تنزيل النسخة واسترجاعها.
الاحتفاظ المحلي 14 يومًا؛ اضبط lifecycle خارجيًا على `pg/` و`objects/` حسب سياسة
الاحتفاظ، مع encryption وversioning ومنع الوصول العام. لا تحذف النسخ قبل نجاح
تجربة الاسترجاع. الصور snapshots يومية كاملة ولها تكلفة تخزين متناسبة مع حجمها.
احفظ `.env` وENCRYPTION_KEY وإعداد Caddy بنسخة مشفرة مستقلة؛ dump وحده لا يكفي.
احتفاظ البيانات اليومي يعني فقدًا محتملًا حتى 24 ساعة؛ Redis يحتفظ بمهامه عبر AOF
محليًا لكنه لا يُنسخ خارجيًا بهذه العملية.

```bash
docker logs --tail 30 sellerctrl-backup
bash scripts/restore-drill.sh
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
sudo ufw status verbose
curl -I https://app.example.com
```

اختبر من شبكة خارج IP الإدارة: 80/443 فقط للموقع، SSH مرفوض، مسارات الإدارة
تعيد 403، ومنافذ 3001/5433/6380/9000/9001/8080 غير متاحة. اختبر تسجيل الدخول،
رفع صورة ومرفق وتحميله بالرابط الموقع، وتشغيل worker وcron. جرّب استعادة dump
في قاعدة منفصلة ونسخ snapshots التخزين إلى buckets اختبار خاصة ومقارنة الملفات؛
لا تستعد فوق الإنتاج. تجربة `restore-drill.sh` تفحص DB فقط ولا تختبر offsite.
النسخة الخارجية يجب أن تكون على حساب/خدمة منفصلة عن VPS وMinIO المحلي.

المراجع: [Docker وUFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/)،
[HTTPS التلقائي في Caddy](https://caddyserver.com/docs/automatic-https)،
[تحديثات Ubuntu](https://ubuntu.com/server/docs/how-to/software/automatic-updates/).
