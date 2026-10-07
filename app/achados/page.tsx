import { redirect } from "next/navigation";
import { getInternalUser } from "@/lib/auth/require-internal";
import { AchadosPanel } from "./AchadosPanel";

export const metadata = {
  title: "Achados — Suricatoos",
};

// Nunca cacheia: reflete achados/evidência ao vivo e é gated por staff interno.
export const dynamic = "force-dynamic";

export default async function AchadosPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; f?: string }>;
}) {
  const staff = await getInternalUser();
  if (!staff) {
    // Não é staff interno (owner/analyst) ou não está logado: esconde tudo.
    redirect("/");
  }
  // Deep-link lido no servidor → vira estado inicial do painel (sem setState em
  // effect, sem mismatch de hidratação).
  const { e, f } = await searchParams;
  return (
    <AchadosPanel
      userEmail={staff.user.email ?? undefined}
      userRole={staff.role}
      initialEngagementId={e}
      initialFindingId={f}
    />
  );
}
