"use server";

import { unstable_rethrow } from "next/navigation";
import { signIn } from "@/auth";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const callbackUrl = (formData.get("callbackUrl") as string) || "/dashboard";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      token: formData.get("token") ?? "",
      redirectTo: callbackUrl,
    });
  } catch (error) {
    // On success signIn throws Next's redirect — rethrow ONLY that (framework
    // errors). Everything else (rejected credentials — whose `instanceof
    // AuthError` is unreliable in the prod bundle — or a transient failure) is
    // surfaced inline instead of crashing to the error boundary.
    unstable_rethrow(error);
    return { error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" };
  }
  return {};
}
