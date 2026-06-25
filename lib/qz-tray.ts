/**
 * QZ Tray browser bridge helper.
 * QZ Tray is a Java applet that runs locally and allows browsers to send
 * raw ZPL/ESC-POS to label printers via WebSocket.
 *
 * Usage:
 *   1. User installs QZ Tray from https://qz.io/download/
 *   2. QZ Tray runs in background (system tray icon)
 *   3. Browser connects via WebSocket on localhost:8181
 *   4. We send ZPL commands to the connected printer
 */

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    qz: any;
  }
}

const QZ_CDN = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";

let loaded = false;

async function loadQzScript(): Promise<void> {
  if (loaded || (typeof window !== "undefined" && window.qz)) { loaded = true; return; }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = QZ_CDN;
    s.onload = () => { loaded = true; resolve(); };
    s.onerror = () => reject(new Error("تعذّر تحميل مكتبة QZ Tray"));
    document.head.appendChild(s);
  });
}

export async function connectQz(): Promise<void> {
  await loadQzScript();
  if (window.qz.websocket.isActive()) return;
  await window.qz.websocket.connect({ retries: 3, delay: 1 });
}

export async function disconnectQz(): Promise<void> {
  if (typeof window !== "undefined" && window.qz?.websocket?.isActive()) {
    await window.qz.websocket.disconnect();
  }
}

export async function listPrinters(): Promise<string[]> {
  await connectQz();
  return window.qz.printers.find() as Promise<string[]>;
}

/** Build a ZPL label for a single barcode.
 * Prints: item name (Arabic), barcode value, item code.
 * Label size: 2" × 1.25" (57mm × 32mm) — common thermal label.
 */
export function buildZplLabel(opts: {
  barcode: string;
  itemCode: string;
  itemName: string;
  qty?: number; // informational — does NOT repeat the label; use copies in printLabels
}): string {
  // ZPL II — ^XA … ^XZ
  // DPI 203; label 406 dots wide (2"), 254 dots tall (1.25")
  const name = opts.itemName.substring(0, 35); // truncate for label
  return [
    "^XA",
    "^CI28",              // UTF-8 font encoding
    "^FO20,10^A0N,24,24^FD" + name + "^FS",
    "^FO20,40^BCN,60,Y,N,N^FD" + opts.barcode + "^FS",
    "^FO20,115^A0N,18,18^FD" + opts.itemCode + "^FS",
    ...(opts.qty !== undefined ? [`^FO280,115^A0N,18,18^FDx${opts.qty}^FS`] : []),
    "^XZ",
  ].join("\n");
}

/** Print barcode labels for multiple items to a named printer.
 * Each item is printed `quantity` times (qty=3 → 3 labels).
 */
export async function printBarcodeLabels(
  printerName: string,
  items: { barcode: string; itemCode: string; itemName: string; quantity: number }[],
): Promise<void> {
  await connectQz();
  const config = window.qz.configs.create(printerName, { copies: 1 });

  // Build one data array — each label repeated `quantity` times
  const data: { type: string; format: string; data: string }[] = [];
  for (const item of items) {
    const zpl = buildZplLabel({ barcode: item.barcode, itemCode: item.itemCode, itemName: item.itemName });
    const copies = Math.max(1, Math.round(item.quantity));
    for (let i = 0; i < copies; i++) {
      data.push({ type: "raw", format: "plain", data: zpl });
    }
  }

  await window.qz.print(config, data);
}
