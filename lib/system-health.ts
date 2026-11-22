import "server-only";
import { sql } from "drizzle-orm";
import { cpus, freemem, loadavg, totalmem, uptime as hostUptime } from "node:os";
import { readFile, statfs } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { join } from "node:path";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { fastRedisReady } from "@/lib/queue/redis";

/**
 * Live checks behind /admin/system. Each component answers pass / warn / fail (the IETF
 * health-check vocabulary) with its latency, a one-line summary, details, and what to do
 * when it is not healthy. Every check has its own timeout, so one hung dependency shows as
 * a failure instead of freezing the whole page. Reads only; nothing here writes except the
 * cron run marker.
 */
export type HealthStatus = "pass" | "warn" | "fail";
export type HealthGroup = "core" | "server" | "network" | "data";
export type HealthCheck = {
  key: string; group: HealthGroup; label: string; status: HealthStatus; ms: number;
  summary: string; details: [string, string][]; hint?: string;
};
type Result = { status: HealthStatus; summary: string; details?: [string, string][]; hint?: string };

const TIMEOUT_MS = 4000;
const CRON_KEY = "health:cron";
const HOUR = 3_600_000;

const fmtBytes = (b: number) => b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;
const pct = (n: number) => `${n.toFixed(0)}%`;
const ago = (ms: number) => ms < 60_000 ? `منذ ${Math.round(ms / 1000)} ث` : ms < HOUR ? `منذ ${Math.round(ms / 60_000)} د` : ms < 48 * HOUR ? `منذ ${(ms / HOUR).toFixed(1)} س` : `منذ ${Math.round(ms / 86_400_000)} يوم`;
const worst = (...s: HealthStatus[]): HealthStatus => s.includes("fail") ? "fail" : s.includes("warn") ? "warn" : "pass";

async function run(key: string, group: HealthGroup, label: string, failHint: string, fn: () => Promise<Result>): Promise<HealthCheck> {
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([fn(), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`لم يرد خلال ${TIMEOUT_MS / 1000} ثوانٍ`)), TIMEOUT_MS); })]);
    return { key, group, label, ms: Date.now() - t0, details: [], ...r, hint: r.status === "pass" ? undefined : r.hint ?? failHint };
  } catch (e) {
    return { key, group, label, ms: Date.now() - t0, status: "fail", summary: e instanceof Error ? e.message : String(e), details: [], hint: failHint };
  } finally { if (timer) clearTimeout(timer); }
}

/** Called by /api/cron at start and end, so the page can tell "never ran", "ran", and "died midway". */
export async function recordCronRun(phase: "started" | "finished", summary?: Record<string, unknown>): Promise<void> {
  try {
    const r = await fastRedisReady();
    if (!r) return;
    await r.hset(CRON_KEY, phase, new Date().toISOString(), ...(summary ? ["summary", JSON.stringify(summary)] : []));
  } catch { /* the status page reports a missing marker; the cron itself must never fail on this */ }
}

type CheckFn = (() => Promise<HealthCheck>) & { pg?: true };
/** Marks a check that queries Postgres. Inside the page these share one scoped transaction, so
 *  they run one after another (a pg client queues concurrent queries anyway, and pg deprecates it). */
const pg = (f: () => Promise<HealthCheck>): CheckFn => Object.assign(f, { pg: true as const });

const checks: CheckFn[] = [
  () => run("app", "core", "التطبيق (الموقع)", "", async () => {
    const build = await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8").catch(() => "—");
    const rss = process.memoryUsage().rss;
    return { status: "pass", summary: `شغّال ${ago(process.uptime() * 1000)}`, details: [
      ["رقم البناء", build.trim()], ["إصدار Node", process.version], ["ذاكرة التطبيق", fmtBytes(rss)],
      ["بدأ التشغيل", new Date(Date.now() - process.uptime() * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ] };
  }),

  pg(() => run("database", "core", "قاعدة البيانات", "تأكد أن حاوية sellerctrl-postgres شغّالة (docker ps) وراجع سجلاتها؛ لو الاتصالات قربت من الحد ابحث عن استعلامات معلّقة.", async () => {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    const latency = Date.now() - t0;
    const [s] = (await db.execute<{ size: string; conns: number; max: number; slow: number; waiting: number; oldest: number | null }>(sql`
      select pg_database_size(current_database())::text size,
        (select count(*)::int from pg_stat_activity where datname = current_database()) conns,
        current_setting('max_connections')::int max,
        (select count(*)::int from pg_stat_activity where datname = current_database() and state = 'active' and now() - query_start > interval '60 seconds') slow,
        (select count(*)::int from pg_locks where not granted) waiting,
        (select extract(epoch from max(now() - xact_start))::int from pg_stat_activity where datname = current_database() and xact_start is not null) oldest`)).rows;
    const used = s.conns / s.max * 100;
    const status = worst(latency > 500 ? "fail" : latency > 150 ? "warn" : "pass", used > 90 ? "fail" : used > 75 ? "warn" : "pass", s.slow > 0 || s.waiting > 0 ? "warn" : "pass");
    return { status, summary: `استجابة ${latency} م.ث — ${s.conns}/${s.max} اتصال`, details: [
      ["الحجم", fmtBytes(Number(s.size))], ["الاتصالات", `${s.conns} من ${s.max} (${pct(used)})`],
      ["استعلامات أطول من دقيقة", String(s.slow)], ["أقفال منتظرة", String(s.waiting)], ["أقدم عملية مفتوحة", s.oldest ? `${s.oldest} ث` : "—"],
    ], hint: "استعلامات بطيئة أو أقفال منتظرة: راجع pg_stat_activity لمعرفة الاستعلام المعلّق؛ امتلاء الاتصالات يعني تسريب اتصالات أو ضغط غير طبيعي." };
  })),

  () => run("redis", "core", "Redis (الطوابير والذاكرة المؤقتة)", "تأكد أن حاوية sellerctrl-redis شغّالة؛ بدونها تتوقف المزامنة والمهام الخلفية.", async () => {
    const r = await fastRedisReady();
    if (!r) return { status: "warn", summary: "غير مضبوط (REDIS_URL)", hint: "المهام الخلفية تعمل داخل التطبيق بدون طابور." };
    const t0 = Date.now();
    await r.ping();
    const latency = Date.now() - t0;
    const info = await r.info("memory");
    const used = Number(/used_memory:(\d+)/.exec(info)?.[1] ?? 0), max = Number(/maxmemory:(\d+)/.exec(info)?.[1] ?? 0);
    const usedPct = max ? used / max * 100 : 0;
    return { status: worst(latency > 200 ? "warn" : "pass", usedPct > 90 ? "fail" : usedPct > 75 ? "warn" : "pass"), summary: `استجابة ${latency} م.ث`,
      details: [["الذاكرة المستخدمة", fmtBytes(used)], ["الحد الأقصى", max ? `${fmtBytes(max)} (${pct(usedPct)})` : "بدون حد"]] };
  }),

  () => run("worker", "core", "المهام الخلفية (Worker)", "الـ worker لا يرسل نبضات: راجع docker logs sellerctrl-worker وأعد تشغيله. بدونه لا مزامنة أوردرات ولا تسويات ولا نسخ احتياطي.", async () => {
    const r = await fastRedisReady();
    if (!r) return { status: "warn", summary: "Redis غير مضبوط" };
    // Same key lib/queue/worker.ts writes; importing that module would load every job handler.
    const beat = Number(await r.get("worker:heartbeat"));
    if (!beat) return { status: "fail", summary: "لا توجد نبضة مسجّلة" };
    const age = Date.now() - beat;
    return { status: age > 120_000 ? "fail" : age > 60_000 ? "warn" : "pass", summary: `آخر نبضة ${ago(age)}` };
  }),

  () => run("queues", "core", "طوابير المهام", "مهام فاشلة أو متراكمة: افتح سجلات الـ worker لمعرفة سبب الفشل (غالبًا صلاحية أمازون أو حد الطلبات).", async () => {
    const r = await fastRedisReady();
    if (!r) return { status: "warn", summary: "Redis غير مضبوط" };
    const { QUEUES } = await import("@/lib/queue/queues");
    const names = Object.values(QUEUES);
    const p = r.pipeline();
    // Failed jobs stay in the set forever (old restarts too); only the last 24h decide the status.
    const since = Date.now() - 24 * HOUR;
    for (const n of names) p.llen(`bull:${n}:wait`).llen(`bull:${n}:active`).zcount(`bull:${n}:failed`, since, "+inf").zcard(`bull:${n}:delayed`);
    const res = (await p.exec()) ?? [];
    const bad = res.find(([err]) => err);
    if (bad) throw bad[0];
    let waiting = 0, failed = 0;
    const details: [string, string][] = [];
    names.forEach((n, i) => {
      const [w, a, f, d] = [0, 1, 2, 3].map((k) => Number(res[i * 4 + k]?.[1] ?? 0));
      waiting += w; failed += f;
      if (w || a || f || d) details.push([n, `منتظرة ${w} · جارية ${a} · فاشلة ${f} · مؤجلة ${d}`]);
    });
    return { status: waiting > 1000 ? "fail" : waiting > 200 || failed > 0 ? "warn" : "pass",
      summary: `${waiting} مهمة منتظرة · ${failed} فاشلة آخر 24 س`, details: details.length ? details : [["كل الطوابير", "فاضية"]] };
  }),

  () => run("cron", "core", "المهام المجدولة اليومية (Cron)", "المهمة اليومية لم تعمل: تأكد أن حاوية sellerctrl-cron شغّالة وأن CRON_SECRET مضبوط. هي المسؤولة عن النسخ الاحتياطي اليومي والتنبيهات.", async () => {
    const r = await fastRedisReady();
    if (!r) return { status: "warn", summary: "Redis غير مضبوط" };
    const m = await r.hgetall(CRON_KEY);
    if (!m.started) return { status: "warn", summary: "لم يُسجَّل تشغيل بعد — يُسجَّل من أول تشغيل قادم (06:00)", hint: "انتظر التشغيل اليومي القادم ثم راجع الصفحة." };
    const started = Date.parse(m.started), finished = m.finished ? Date.parse(m.finished) : 0;
    const age = Date.now() - (finished || started);
    const died = started > finished && Date.now() - started > 30 * 60_000;
    let sum: Record<string, unknown> = {};
    try { sum = JSON.parse(m.summary ?? "{}"); } catch { /* ignore */ }
    const details: [string, string][] = [["آخر بداية", m.started.slice(0, 16).replace("T", " ")], ["آخر انتهاء", m.finished?.slice(0, 16).replace("T", " ") ?? "—"]];
    for (const [k, v] of Object.entries(sum)) if (k !== "ok") details.push([k, String(v)]);
    return { status: died ? "fail" : age > 26 * HOUR ? "fail" : "pass",
      summary: died ? "بدأت ولم تكتمل" : `آخر تشغيل ${ago(age)}`, details,
      hint: died ? "التشغيل الأخير توقف في المنتصف: راجع docker logs sellerctrl-app حول وقت التشغيل." : undefined };
  }),

  () => run("storage", "core", "التخزين (الملفات والصور)", "التخزين لا يرد: تأكد أن حاوية sellerctrl-minio شغّالة؛ بدونها لا تظهر الصور ولا تُحفظ المرفقات والنسخ.", async () => {
    const { s3, storageBucket } = await import("@/lib/storage");
    const priv = process.env.S3_PRIVATE_BUCKET ?? "sellerctrl-private";
    const t0 = Date.now();
    await s3.send(new HeadBucketCommand({ Bucket: storageBucket }));
    await s3.send(new HeadBucketCommand({ Bucket: priv }));
    const latency = Date.now() - t0;
    return { status: latency > 1000 ? "warn" : "pass", summary: `الحاويتان متاحتان — ${latency} م.ث`, details: [["العامة", storageBucket], ["الخاصة", priv]] };
  }),

  () => run("cpu", "server", "المعالج (CPU)", "حمل عالٍ مستمر: راجع docker stats لمعرفة الحاوية المستهلكة (غالبًا بناء أو مزامنة كبيرة).", async () => {
    const cores = cpus().length, [l1, l5, l15] = loadavg(), perCore = l5 / cores;
    return { status: perCore > 2 ? "fail" : perCore > 1 ? "warn" : "pass", summary: `حمل ${l5.toFixed(2)} على ${cores} أنوية`,
      details: [["الحمل (1/5/15 د)", `${l1.toFixed(2)} / ${l5.toFixed(2)} / ${l15.toFixed(2)}`], ["الأنوية", String(cores)], ["السيرفر شغّال منذ", `${(hostUptime() / 86400).toFixed(1)} يوم`]] };
  }),

  () => run("memory", "server", "الذاكرة (RAM)", "الذاكرة قربت تخلص: راجع docker stats؛ امتلاؤها يوقف قاعدة البيانات أو يقتل التطبيق.", async () => {
    const total = totalmem(), used = total - freemem(), p = used / total * 100;
    return { status: p > 95 ? "fail" : p > 85 ? "warn" : "pass", summary: `${pct(p)} مستخدمة`, details: [["المستخدم", fmtBytes(used)], ["الإجمالي", fmtBytes(total)]] };
  }),

  () => run("disk", "server", "مساحة التخزين (الهارد)", "الهارد قرب يتملي: نظّف صور Docker القديمة (docker image prune) والنسخ الاحتياطية القديمة. امتلاؤه يوقف قاعدة البيانات.", async () => {
    const s = await statfs("/");
    const total = Number(s.blocks) * Number(s.bsize), free = Number(s.bavail) * Number(s.bsize), p = (total - free) / total * 100;
    return { status: p > 90 ? "fail" : p > 80 ? "warn" : "pass", summary: `${pct(p)} مستخدمة — متاح ${fmtBytes(free)}`, details: [["الإجمالي", fmtBytes(total)], ["المتاح", fmtBytes(free)]] };
  }),

  () => run("internet", "network", "الإنترنت والـ DNS", "السيرفر غير قادر على الوصول للإنترنت: راجع الشبكة وجدار Contabo/ufw للاتصالات الخارجة؛ بدونه تتوقف مزامنة أمازون والإيميل.", async () => {
    const host = "sellingpartnerapi-eu.amazon.com";
    const t0 = Date.now();
    const { address } = await lookup(host);
    const dnsMs = Date.now() - t0;
    const t1 = Date.now();
    const res = await fetch(`https://${host}/`, { method: "HEAD", signal: AbortSignal.timeout(3500) });
    const httpMs = Date.now() - t1;
    return { status: httpMs > 2000 ? "warn" : "pass", summary: `أمازون يرد — ${httpMs} م.ث`, details: [["DNS", `${address} (${dnsMs} م.ث)`], ["HTTPS", `HTTP ${res.status} (${httpMs} م.ث)`]] };
  }),

  () => run("tls", "network", "شهادة HTTPS", "الشهادة قربت تخلص أو لا يمكن قراءتها: راجع docker logs sellerctrl-caddy (التجديد تلقائي ويحتاج المنفذ 80 مفتوح).", async () => {
    const domain = process.env.APP_DOMAIN || (process.env.APP_URL ? new URL(process.env.APP_URL).hostname : "");
    if (!domain || domain === "localhost") return { status: "warn", summary: "لا يوجد نطاق مضبوط (APP_DOMAIN)" };
    const validTo = await new Promise<string>((resolve, reject) => {
      const tryHost = (host: string, next?: () => void) => {
        const sock = tlsConnect({ host, port: 443, servername: domain, timeout: 2500 }, () => { const v = sock.getPeerCertificate().valid_to; sock.end(); resolve(v); });
        sock.on("error", (e) => { sock.destroy(); if (next) next(); else reject(e); });
        sock.on("timeout", () => { sock.destroy(); if (next) next(); else reject(new Error("timeout")); });
      };
      tryHost("caddy", () => tryHost(domain)); // the reverse proxy on the compose network, else the public name
    });
    const days = Math.floor((Date.parse(validTo) - Date.now()) / 86_400_000);
    return { status: days < 7 ? "fail" : days < 21 ? "warn" : "pass", summary: `صالحة ${days} يوم`, details: [["النطاق", domain], ["تنتهي", validTo]] };
  }),

  pg(() => run("marketplaces", "network", "ربط المنصات (أمازون / نون)", "ربط منصة يحتاج إعادة تفويض أو مزامنته متوقفة: افتح المنصة من صفحة الشركة وأعد الربط، وراجع آخر خطأ في سجل المزامنة.", async () => {
    const rows = (await db.execute<{ org: string; provider: string; reauth: boolean; status: string | null; last: string | null; orders: string | null; settle: string | null }>(sql`
      select o.name_ar org, c.provider, c.needs_reauth reauth, c.last_sync_status status, c.last_sync_at::text last, c.orders_synced_at::text orders, c.settlements_synced_at::text settle
      from platform_credentials c join organizations o on o.id = c.organization_id order by o.name_ar, c.provider`)).rows;
    const [fails] = (await db.execute<{ n: number; last: string | null }>(sql`
      select count(*)::int n, (array_agg(left(error, 140) order by started_at desc))[1] last from sync_runs where status = 'FAILED' and started_at > now() - interval '24 hours'`)).rows;
    if (!rows.length) return { status: "pass", summary: "لا توجد منصات مربوطة" };
    const now = Date.now();
    let status: HealthStatus = "pass";
    const details: [string, string][] = rows.map((c) => {
      const ordersAge = c.orders ? now - Date.parse(c.orders) : Infinity;
      const settleAge = c.settle ? now - Date.parse(c.settle) : Infinity;
      const s: HealthStatus = c.reauth ? "fail" : ordersAge > 6 * HOUR || settleAge > 72 * HOUR ? "warn" : "pass";
      status = worst(status, s);
      return [`${c.org} — ${c.provider}`, c.reauth ? "يحتاج إعادة ربط ⛔" : `أوردرات ${c.orders ? ago(ordersAge) : "لم تُزامن"} · تسويات ${c.settle ? ago(settleAge) : "لم تُزامن"}`];
    });
    if (fails.n) { status = worst(status, "warn"); details.push(["مزامنات فاشلة آخر 24 س", `${fails.n} — آخر خطأ: ${fails.last ?? "—"}`]); }
    return { status, summary: `${rows.length} ربط — ${fails.n} مزامنة فاشلة آخر 24 س`, details };
  })),

  pg(() => run("backups", "data", "النسخ الاحتياطي للشركات", "نسخة الشركة الاحتياطية اليومية متأخرة أو فاشلة: راجع سجلات الـ worker (طابور maintenance) والتخزين.", async () => {
    const rows = (await db.execute<{ org: string; status: string | null; ok: string | null; fail: string | null; size: string | null }>(sql`
      select o.name_ar org, h.status, h.last_success_at::text ok, h.last_failure_at::text fail,
        (select size_bytes::text from backup_runs b where b.organization_id = o.id order by created_at desc limit 1) size
      from organizations o left join organization_backup_health h on h.organization_id = o.id where not o.is_sandbox order by o.name_ar`)).rows;
    let status: HealthStatus = "pass";
    const details: [string, string][] = rows.map((r) => {
      const age = r.ok ? Date.now() - Date.parse(r.ok) : Infinity;
      const failedLast = r.fail && (!r.ok || Date.parse(r.fail) > Date.parse(r.ok));
      status = worst(status, failedLast || age > 50 * HOUR ? "fail" : age > 30 * HOUR ? "warn" : "pass");
      return [r.org, `${r.ok ? `آخر نسخة ناجحة ${ago(age)}` : "لا توجد نسخة ناجحة"}${r.size ? ` · ${fmtBytes(Number(r.size))}` : ""}${failedLast ? " · آخر محاولة فشلت ⛔" : ""}`];
    });
    details.push(["نسخة قاعدة البيانات الكاملة", "على السيرفر نفسه فقط — لا توجد نسخة خارجية"]);
    return { status, summary: `${rows.length} شركة — النسخ على السيرفر فقط`, details,
      hint: "النسخ كلها على نفس السيرفر: لو السيرفر ضاع تضيع معه. يُنصح بربط تخزين خارجي (Cloudflare R2 / Backblaze)." };
  })),

  () => run("errors", "data", "الأخطاء المسجّلة", "أخطاء متكررة: الاسم يدل على المكان (مثلاً sync.* = مزامنة، cron.* = المهام اليومية)؛ راجع docker logs للتفاصيل.", async () => {
    const r = await fastRedisReady();
    if (!r) return { status: "warn", summary: "Redis غير مضبوط" };
    const now = Date.now(), keys = Array.from({ length: 24 }, (_, i) => `health:errors:${new Date(now - i * HOUR).toISOString().slice(0, 13)}`);
    const p = r.pipeline();
    for (const k of keys) p.hgetall(k);
    const res = (await p.exec()) ?? [];
    const bad = res.find(([err]) => err);
    if (bad) throw bad[0];
    const byEvent = new Map<string, number>();
    let lastHour = 0, day = 0;
    res.forEach(([, h], i) => {
      for (const [ev, n] of Object.entries((h ?? {}) as Record<string, string>)) {
        const c = Number(n); day += c; if (i === 0) lastHour += c;
        byEvent.set(ev, (byEvent.get(ev) ?? 0) + c);
      }
    });
    const top = [...byEvent].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([e, n]): [string, string] => [e, `${n} مرة`]);
    return { status: lastHour > 50 ? "fail" : lastHour > 0 || day > 20 ? "warn" : "pass", summary: `آخر ساعة ${lastHour} · آخر 24 س ${day}`,
      details: top.length ? top : [["آخر 24 ساعة", "لا توجد أخطاء"]] };
  }),
];

export async function runHealthChecks(): Promise<{ checks: HealthCheck[]; overall: HealthStatus; at: string }> {
  const results: HealthCheck[] = new Array(checks.length);
  const pgChain = (async () => {
    for (const [i, c] of checks.entries()) if (c.pg) results[i] = await c();
  })();
  await Promise.all([pgChain, ...checks.map(async (c, i) => { if (!c.pg) results[i] = await c(); })]);
  return { checks: results, overall: worst(...results.map((c) => c.status)), at: new Date().toISOString() };
}
