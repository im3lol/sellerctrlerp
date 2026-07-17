/**
 * Turn a stored phone number into the digits wa.me expects (country code, no +).
 *
 * Egypt-first, because the whole product is (EGP, ar-EG). The old inline version
 * replaced a leading 0 with "966" — Saudi Arabia's code — so an Egyptian mobile
 * 01025246324 became 96625246324 and the WhatsApp link opened a stranger's chat.
 *
 * Rules, in order:
 *  - already international (+… or 00…) → keep its own country code, just strip the prefix.
 *  - local (leading 0) → it's an Egyptian number; swap the 0 for 20.
 *  - anything else → leave the digits as typed (best effort; could already carry a code).
 *
 * Returns "" when there's nothing dialable, so the caller can hide the button.
 */
export function waNumber(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  if (trimmed.startsWith("+")) return digits;        // +2010… → 2010…
  if (digits.startsWith("00")) return digits.slice(2); // 002010… → 2010…
  if (digits.startsWith("0")) return "20" + digits.slice(1); // 010… → 2010… (Egypt)
  return digits;
}
