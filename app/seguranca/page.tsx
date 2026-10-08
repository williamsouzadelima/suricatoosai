import { redirect } from "next/navigation";
import { getInternalUser } from "@/lib/auth/require-internal";
import { SegurancaPanel } from "./SegurancaPanel";

export const metadata = {
  title: "Segurança — Suricatoos",
};

// Nunca cacheia: reflete sessões/dispositivos ao vivo e é gated por staff interno.
export const dynamic = "force-dynamic";

export default async function SegurancaPage() {
  const staff = await getInternalUser();
  if (!staff) {
    // Não é staff interno (owner/analyst) ou não está logado: esconde tudo.
    redirect("/");
  }
  return (
    <SegurancaPanel
      userEmail={staff.user.email ?? undefined}
      userRole={staff.role}
    />
  );
}
