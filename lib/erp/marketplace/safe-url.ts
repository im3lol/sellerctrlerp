/**
 * SSRF guard for the connectors whose endpoint is TENANT-SUPPLIED (WooCommerce store
 * origin, Jumia SellerCenter base). Amazon/Noon/Shopify hit fixed or pattern-locked hosts
 * and don't need this.
 *
 * Without it, an org member who can connect a store points the URL at an internal address
 * and the app/worker fetches it from inside the network — with the tenant's own auth
 * header attached. https-only is not a defence: https://127.0.0.1 parses fine.
 */

/** Private/loopback/link-local/CGNAT ranges + IPv6 equivalents, as literal-IP text. */
function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||               // link-local + cloud metadata 169.254.169.254
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||     // CGNAT
      a >= 224                                   // multicast + reserved
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1" || v6 === "::") return true;
  if (/^f[cd]/.test(v6)) return true;            // unique-local fc00::/7
  if (/^fe[89ab]/.test(v6)) return true;         // link-local fe80::/10
  // IPv4-mapped (::ffff:127.0.0.1) — re-check the embedded v4.
  const mapped = v6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  return mapped ? isPrivateIp(mapped[1]) : false;
}

/**
 * Reject a hostname that is obviously internal without touching DNS: a literal private IP,
 * localhost, or a non-routable suffix. Pure + sync so the connect form can refuse instantly.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = (hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // bare hostname → intranet name
  return isPrivateIp(h);
}

/**
 * Call-time check, right before the fetch: resolves the host and refuses if ANY answer is
 * private. Re-checking here (not only at connect time) is what makes a later DNS flip —
 * a public name repointed at 127.0.0.1 — fail instead of succeed.
 */
export async function assertPublicUrl(url: string | URL): Promise<void> {
  const u = typeof url === "string" ? new URL(url) : url;
  if (u.protocol !== "https:") throw new Error("يجب أن يكون العنوان https");
  if (isBlockedHost(u.hostname)) throw new Error("عنوان داخلي غير مسموح به");
  // A literal IP needs no lookup; a name does.
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) return;
  let addrs: { address: string }[];
  try {
    const { lookup } = await import("dns/promises");
    addrs = await lookup(u.hostname, { all: true });
  } catch {
    throw new Error("تعذّر التحقق من عنوان المتجر");
  }
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("عنوان داخلي غير مسموح به");
}
