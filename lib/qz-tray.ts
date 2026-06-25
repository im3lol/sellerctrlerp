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
 * Label size: 50mm × 25mm (5cm × 2.5cm) at 203 DPI.
 *   Width  = 50mm × 203/25.4 ≈ 400 dots
 *   Height = 25mm × 203/25.4 ≈ 200 dots
 */
export function buildZplLabel(opts: {
  barcode: string;
  itemCode: string;
  itemName: string;
}): string {
  const name = opts.itemName.substring(0, 30);
  return [
    "^XA",
    "^PW400",               // print width 400 dots (50 mm @ 203 dpi)
    "^LL200",               // label length 200 dots (25 mm @ 203 dpi)
    "^CI28",                // UTF-8 encoding
    // item name (top, small font)
    "^FO10,8^A0N,18,18^FD" + name + "^FS",
    // CODE128 barcode, height 80 dots, with human-readable below
    "^FO10,30^BCN,80,Y,N,N^FD" + opts.barcode + "^FS",
    // item code (bottom right)
    "^FO250,170^A0N,16,16^FD" + opts.itemCode + "^FS",
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
