import { redirect } from "next/navigation";
import { getInternalUser } from "@/lib/auth/require-internal";
import { isSuperadmin } from "@/lib/auth/superadmin";
import { EngagementsPanel } from "./EngagementsPanel";

export const metadata = {
  title: "Engajamentos — Suricatoos",
};

// Nunca cacheia: reflete evidência/achados ao vivo e é gated por staff interno.
export const dynamic = "force-dynamic";

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const staff = await getInternalUser();
  if (!staff) {
    // Não é staff interno (owner/analyst) ou não está logado: esconde tudo.
    redirect("/");
  }
  // Deep-link lido no servidor → estado inicial do painel (sem setState em
  // effect, sem mismatch de hidratação). Espelha achados/relatorios.
  const { e } = await searchParams;
  return (
    <EngagementsPanel
      userEmail={staff.user.email ?? undefined}
      userRole={staff.role}
      isSuperadmin={isSuperadmin(staff.user.email ?? "")}
      initialEngagementId={e}
    />
  );
}
