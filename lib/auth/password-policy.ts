// Shared password policy — one source of truth for every place a password is set
// (signup, admin user create/edit, member invite). Enforces the Amazon Data
// Protection Policy baseline: 12-character minimum WITH complexity (upper, lower,
// digit, special). Pure + no imports so it is unit-testable and client-safe.

export const PASSWORD_MIN = 12;

/** Human-readable rule, shown as placeholder/help text. */
export const PASSWORD_RULE_AR = `${PASSWORD_MIN} حرفًا على الأقل، وتشمل حرفًا كبيرًا وصغيرًا ورقمًا ورمزًا خاصًا`;

/** bcrypt work factor for all new hashes (raised from 10). */
export const BCRYPT_COST = 12;

/** Returns an Arabic error message if the password fails policy, or null if it passes. */
export function validatePassword(pw: string): string | null {
  if (!pw || pw.length < PASSWORD_MIN) return `كلمة المرور يجب أن تكون ${PASSWORD_MIN} حرفًا على الأقل`;
  if (!/[a-z]/.test(pw)) return "كلمة المرور يجب أن تحتوي على حرف لاتيني صغير";
  if (!/[A-Z]/.test(pw)) return "كلمة المرور يجب أن تحتوي على حرف لاتيني كبير";
  if (!/[0-9]/.test(pw)) return "كلمة المرور يجب أن تحتوي على رقم";
  if (!/[^A-Za-z0-9]/.test(pw)) return "كلمة المرور يجب أن تحتوي على رمز خاص (مثل !@#$)";
  return null;
}

/** Convenience boolean for client-side form validity. */
export const isPasswordValid = (pw: string): boolean => validatePassword(pw) === null;
