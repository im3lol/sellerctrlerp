// Browser-only: load xpay's checkout SDK once and open the drop-in modal on our own
// domain. The SDK is served from a fixed URL; the publishable key scopes it and the
// clientSecret binds it to one session. Success is confirmed server-side by the webhook —
// onComplete is just UX.

type XpayFactory = (pk: string) => { checkout: (opts: Record<string, unknown>) => { open: () => void } };

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

export async function openXpayDropIn(opts: { publishableKey: string; clientSecret: string; onComplete: () => void; onClose?: () => void }) {
  const XPay = await loadSdk();
  const xpay = XPay(opts.publishableKey);
  const dark = document.documentElement.classList.contains("dark");
  const checkout = xpay.checkout({
    clientSecret: opts.clientSecret,
    mode: "modal",
    locale: "ar",
    appearance: { colorMode: dark ? "dark" : "light" },
    onComplete: () => opts.onComplete(),
    onClose: () => opts.onClose?.(),
  });
  checkout.open();
}
