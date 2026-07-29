// Browser-only: mount xpay's Elements payment field inside OUR branded checkout page.
// The SDK loads once; the publishable key scopes it and the clientSecret binds it to a
// session. Only the card field is xpay's (a PCI iframe) — everything around it is ours.
// Success is confirmed server-side by the webhook; the confirm() result is just UX.

type XpayCheckout = {
  getElements: () => { create: (type: string) => XpayElement };
  confirm: (opts: Record<string, unknown>) => Promise<{ type: "success" | "error"; error?: { message?: string }; session?: unknown }>;
  canConfirm?: boolean;
};
type XpayElement = { mount: (sel: string) => void; on: (evt: string, cb: (e: { complete?: boolean }) => void) => void };
type XpayInstance = { initCheckout: (opts: Record<string, unknown>) => Promise<XpayCheckout> };
type XpayFactory = (pk: string) => XpayInstance;

let sdkPromise: Promise<XpayFactory> | null = null;

function loadSdk(): Promise<XpayFactory> {
  const w = window as unknown as { XPay?: XpayFactory };
  if (w.XPay) return Promise.resolve(w.XPay);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<XpayFactory>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.xpay.app/v1/sdk.js";
    s.async = true;
    s.onload = () => (w.XPay ? resolve(w.XPay) : reject(new Error("تعذّر تحميل بوابة الدفع")));
    s.onerror = () => { sdkPromise = null; reject(new Error("تعذّر تحميل بوابة الدفع")); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

/** Init an Elements checkout and mount the payment field. Returns the checkout handle so
 *  the caller can call `checkout.confirm({ customerDetails, redirect })`. */
export async function initXpayElements(opts: {
  publishableKey: string; clientSecret: string; mountSelector: string;
  colorPrimary: string; colorMode: "light" | "dark"; onChange: (canPay: boolean) => void;
}): Promise<XpayCheckout> {
  const XPay = await loadSdk();
  const xpay = XPay(opts.publishableKey);
  const checkout = await xpay.initCheckout({
    clientSecret: opts.clientSecret,
    colorMode: opts.colorMode,
    borderStyle: "rounded",
    colors: { primary: opts.colorPrimary },
    locale: "ar",
  });
  const el = checkout.getElements().create("payment");
  el.mount(opts.mountSelector);
  el.on("change", (e) => opts.onChange(!!e.complete && (checkout.canConfirm ?? true)));
  return checkout;
}
