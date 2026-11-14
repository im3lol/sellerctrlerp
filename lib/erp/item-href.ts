/** Public item addresses use the company-scoped item code, never the database id. */
export const itemHref = (code: string, suffix: "" | "/edit" = "") =>
  `/inventory/items/${encodeURIComponent(code)}${suffix}`;
