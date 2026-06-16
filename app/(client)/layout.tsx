import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/app-shell/user-menu";
import type { Role } from "@/lib/rbac";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Staff belong in the main app; only clients use the portal.
  if (user.role !== "client") redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:px-8">
        <Logo className="text-2xl text-primary" />
        <UserMenu name={user.name} email={user.email} role={user.role as Role} avatarUrl={user.avatarUrl} />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
