// Minimal typings for the qz-tray browser SDK (no official @types). Only the surface
// the barcode-label printing uses; extend as needed.
declare module "qz-tray" {
  const qz: {
    websocket: {
      isActive(): boolean;
      connect(opts?: { retries?: number; delay?: number }): Promise<void>;
      disconnect(): Promise<void>;
    };
    printers: {
      find(query?: string): Promise<string | string[]>;
      getDefault(): Promise<string>;
    };
    configs: { create(printer: string, opts?: Record<string, unknown>): unknown };
    print(cfg: unknown, data: { type: string; format?: string; flavor?: string; data: string }[]): Promise<void>;
    security: {
      setCertificatePromise(fn: (resolve: (cert: string | null) => void, reject: (e: unknown) => void) => void): void;
      setSignaturePromise(fn: (toSign: string) => (resolve: (sig: string | null) => void, reject: (e: unknown) => void) => void): void;
      setSignatureAlgorithm(algorithm: "SHA1" | "SHA256" | "SHA512"): void;
    };
  };
  export default qz;
}
