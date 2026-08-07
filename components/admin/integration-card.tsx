"use client";

import { SettingsTile } from "./settings-tile";
import { IntegrationSettingsForm, type IntegrationInitial } from "./integration-settings-form";
import type { IntegrationField } from "@/lib/erp/marketplace/connector";

// Per-connector brand accent + icon (no brand SVGs available — a coloured badge + a
// commerce glyph reads clearly). Unknown connectors fall back to a neutral store tile.
const BRAND: Record<string, { cls: string; icon: string }> = {
  AMAZON: { cls: "bg-amber-500/15 text-amber-600", icon: "Store" },
  NOON: { cls: "bg-yellow-400/20 text-yellow-600", icon: "ShoppingBag" },
  SHOPIFY: { cls: "bg-emerald-500/15 text-emerald-600", icon: "ShoppingCart" },
};

/** A sales-platform tile that opens the connector's config dialog. */
export function IntegrationCard({ code, label, fields, hasOAuth, appUrl, initial }: {
  code: string; label: string; fields: IntegrationField[]; hasOAuth: boolean; appUrl: string; initial: IntegrationInitial;
}) {
  const brand = BRAND[code] ?? { cls: "bg-muted text-muted-foreground", icon: "Store" };
  // Server already folded in env-config + a live connection (Amazon's creds live in env);
  // keep the row-only check as a floor for older callers.
  const configured = initial.configured || initial.has.clientSecret || !!initial.text.clientId;
  return (
    <SettingsTile
      label={label} icon={brand.icon} brandCls={brand.cls}
      configured={configured} enabled={initial.enabled}
      dialogTitle={`ربط ${label}`} dialogDescription="أدخل مفاتيح التطبيق لتفعيل الربط. تُخزَّن الأسرار مشفّرة."
    >
      <IntegrationSettingsForm code={code} label={label} fields={fields} hasOAuth={hasOAuth} appUrl={appUrl} initial={initial} />
    </SettingsTile>
  );
}
