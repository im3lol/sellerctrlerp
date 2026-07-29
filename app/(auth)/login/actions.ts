"use server";

import { unstable_rethrow } from "next/navigation";
import { signIn } from "@/auth";
import { passwordLoginStep } from "@/lib/auth/verify-credentials";

export type LoginState = { error?: string; mfaRequired?: boolean };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const callbackUrl = (formData.get("callbackUrl") as string) || "/dashboard";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const token = String(formData.get("token") ?? "").trim();

  // Step 1 (no code yet): validate the password and find out whether this
  // account still needs a second factor — so 2FA is a second screen, shown only
  // to accounts that enabled it, instead of a field everyone sees up front.
  if (!token) {
    const step = await passwordLoginStep(email, password);
    if (step === "invalid") return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
    if (step === "mfa") return { mfaRequired: true };
    // step === "ok" → no 2FA, fall through and sign in immediately.
  }

  try {
    await signIn("credentials", { email, password, token, redirectTo: callbackUrl });
  } catch (error) {
    // On success signIn throws Next's redirect — rethrow ONLY that (framework
    // errors). Everything else (rejected credentials — whose `instanceof
    // AuthError` is unreliable in the prod bundle — or a transient failure) is
    // surfaced inline instead of crashing to the error boundary. The password was
    // already validated above, so a failure with a code present means a bad code.
    unstable_rethrow(error);
    return token
      ? { error: "رمز المصادقة غير صحيح", mfaRequired: true }
      : { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  }
  return {};
}
