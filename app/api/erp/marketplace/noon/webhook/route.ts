export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Noon order webhook — disabled while production is Amazon-only (lib/saas/connector-enabled.ts).
// The previous ingest handler lives in git history (before this commit); restore it from there
// when Noon is switched back on. 410 tells Noon the endpoint is gone rather than retry-worthy.
export async function POST() {
  return new Response(JSON.stringify({ ok: false, error: "نون قريبًا — الاستقبال متوقف حاليًا" }), {
    status: 410, headers: { "content-type": "application/json" },
  });
}
