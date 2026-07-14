/**
 * Capacitor bridge helpers — safe to import anywhere. On the web (no Capacitor)
 * every call is a no-op, so components stay identical in the browser and only
 * light up inside the Android/iOS shell.
 */

type Cap = { isNativePlatform?: () => boolean };

/** True only when running inside the native Capacitor shell (Android app). */
export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { Capacitor?: Cap }).Capacitor?.isNativePlatform?.());
}

/**
 * Open the native camera barcode scanner and return the first scanned value
 * (null if unavailable/denied/cancelled). Plugin is dynamically imported so the
 * web bundle never loads native code and the browser build is unaffected.
 */
export async function scanBarcode(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
    const perm = await BarcodeScanner.requestPermissions();
    if (perm.camera !== "granted" && perm.camera !== "limited") return null;
    const { barcodes } = await BarcodeScanner.scan();
    return barcodes[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}
