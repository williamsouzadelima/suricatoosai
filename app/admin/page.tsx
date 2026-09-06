import { redirect } from "next/navigation";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { isInviteOnlyEnabled } from "@/lib/auth/invite-access";
import { AdminPanel } from "./AdminPanel";

export const metadata = {
  title: "Admin — Controle de acesso",
};

// Never cache: the panel reflects live allowlist state and is superadmin-gated.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getSuperadminUser();
  if (!admin) {
    // Not a superadmin (or not signed in): hide the panel entirely.
    redirect("/");
  }

  return (
    <AdminPanel
      adminEmail={admin.email ?? ""}
      inviteOnlyEnabled={isInviteOnlyEnabled()}
    />
  );
}
