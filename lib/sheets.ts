/**
 * Google Sheets integration (spec §7). Uses a service account.
 * Provide credentials via GOOGLE_SERVICE_ACCOUNT_JSON (inline JSON) or
 * GOOGLE_SERVICE_ACCOUNT_FILE (path to a mounted JSON file).
 *
 * NOTE: `googleapis` is huge, so it is imported lazily (dynamic import inside
 * the client factory) — this keeps it out of the server-startup/cron module
 * graph and most route bundles, dramatically cutting cold-compile time.
 */

function getCredentials(): Record<string, unknown> | null {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inline && inline.trim().startsWith("{")) {
    try {
      return JSON.parse(inline);
    } catch {
      return null;
    }
  }
  return null;
}

export function sheetsConfigured(): boolean {
  return getCredentials() !== null || !!process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
}

async function sheetsClient() {
  const { google } = await import("googleapis");
  const credentials = getCredentials();
  const auth = new google.auth.GoogleAuth({
    ...(credentials
      ? { credentials }
      : { keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE }),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

export type SheetRow = Record<string, string>;

/**
 * Read all rows from a sheet as objects keyed by the header row.
 * Returns { headers, rows } where each row also carries a stable `__rowRef`.
 */
export async function readSheet(
  spreadsheetId: string,
  sheetName: string,
  headerRow = 1,
): Promise<{ headers: string[]; rows: (SheetRow & { __rowRef: string })[] }> {
  const sheets = await sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });
  const values = (res.data.values ?? []) as string[][];
  if (values.length < headerRow) return { headers: [], rows: [] };

  const headers = (values[headerRow - 1] ?? []).map((h) => String(h).trim());
  const rows: (SheetRow & { __rowRef: string })[] = [];

  for (let i = headerRow; i < values.length; i++) {
    const raw = values[i] ?? [];
    if (raw.every((c) => !c || String(c).trim() === "")) continue; // skip blank rows
    const obj: SheetRow = {};
    headers.forEach((h, idx) => {
      obj[h] = raw[idx] != null ? String(raw[idx]) : "";
    });
    rows.push({ ...obj, __rowRef: `${sheetName}!${i + 1}` });
  }
  return { headers, rows };
}

/** Fetch only the header row — used by the connection setup UI for column mapping. */
export async function readHeaders(
  spreadsheetId: string,
  sheetName: string,
  headerRow = 1,
): Promise<string[]> {
  const sheets = await sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${headerRow}:${headerRow}`,
  });
  return ((res.data.values?.[0] ?? []) as string[]).map((h) => String(h).trim());
}
