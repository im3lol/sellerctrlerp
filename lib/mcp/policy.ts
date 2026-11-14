import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ErpPermission } from "@/lib/erp/permissions";

export const MCP_SCOPES: Record<string, { label: string; permission?: ErpPermission; module?: string }> = {
  "erp.identity": { label: "الحساب والشركة المحددة" },
  "inventory.read": { label: "قراءة الأصناف والمخزون", permission: "inventory.view", module: "inventory" },
  "purchases.read": { label: "قراءة المشتريات", permission: "purchases.view", module: "purchases" },
  "sales.read": { label: "قراءة المبيعات", permission: "sales.view", module: "sales" },
  "accounting.read": { label: "قراءة التقارير المالية", permission: "accounting.view", module: "accounting" },
  "marketplace.read": { label: "حالة ربط المنصات", permission: "sales.view", module: "marketplace" },
};
export const opaque = () => randomBytes(32).toString("base64url");
export const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  return timingSafeEqual(Buffer.from(digest(verifier)), Buffer.from(challenge));
}
export function parseScopes(value: string): string[] {
  const scopes = [...new Set(value.trim().split(/\s+/).filter(Boolean))];
  if (!scopes.length || scopes.some(s => !Object.hasOwn(MCP_SCOPES, s))) throw new Error("invalid_scope");
  return scopes;
}
export function validRedirect(value: string): boolean {
  try {
    const u = new URL(value);
    return value.length <= 2048 && value.trim() === value && !value.includes("#") && !u.username && !u.password &&
      (u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname)));
  } catch { return false; }
}
export function mcpUrls() {
  const base = process.env.MCP_PUBLIC_URL || `${(process.env.APP_URL || "http://localhost:3001").replace(/\/$/, "")}/mcp`;
  const resource = new URL(base);
  if (resource.search || resource.hash || resource.pathname !== "/mcp" || resource.username || resource.password) throw new Error("Invalid MCP_PUBLIC_URL");
  if (process.env.NODE_ENV === "production" && resource.protocol !== "https:") throw new Error("MCP requires HTTPS in production");
  return { resource: resource.href, origin: resource.origin, issuer: `${resource.origin}/api/mcp/oauth` };
}
