export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WooCommerce order webhook — disabled while production is Amazon-only (lib/saas/connector-enabled.ts).
// The previous ingest handler lives in git history (before this commit); restore it from there
// when Woo is switched back on.
export async function POST() {
  return new Response(JSON.stringify({ ok: false, error: "ووكومرس قريبًا — الاستقبال متوقف حاليًا" }), {
    status: 410, headers: { "content-type": "application/json" },
  });
}
