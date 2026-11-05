import { redirect } from "next/navigation";
import { getInternalUser } from "@/lib/auth/require-internal";
import { isSuperadmin } from "@/lib/auth/superadmin";
import { AchadosPanel } from "./AchadosPanel";

export const metadata = {
  title: "Achados — Suricatoos",
};

// Nunca cacheia: reflete achados/evidência ao vivo e é gated por staff interno.
export const dynamic = "force-dynamic";

export default async function AchadosPage() {
  const staff = await getInternalUser();
  if (!staff) {
    // Não é staff interno (owner/analyst) ou não está logado: esconde tudo.
    redirect("/");
  }
  // A seleção (?e=) e o achado aberto (?f=) são lidos no cliente via
  // useSearchParams (rota force-dynamic → sem Suspense, sem mismatch).
  return (
    <AchadosPanel
      userEmail={staff.user.email ?? undefined}
      userRole={staff.role}
      isSuperadmin={isSuperadmin(staff.user.email ?? "")}
    />
  );
}
