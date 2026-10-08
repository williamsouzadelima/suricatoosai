import { redirect } from "next/navigation";
import { getInternalUser } from "@/lib/auth/require-internal";
import { RelatoriosPanel } from "./RelatoriosPanel";

export const metadata = {
  title: "Relatórios — Suricatoos",
};

// Nunca cacheia: reflete o status de geração ao vivo e é gated por staff interno.
export const dynamic = "force-dynamic";

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const staff = await getInternalUser();
  if (!staff) {
    // Não é staff interno (owner/analyst) ou não está logado: esconde tudo.
    redirect("/");
  }
  const { e } = await searchParams;
  return (
    <RelatoriosPanel
      userEmail={staff.user.email ?? undefined}
      userRole={staff.role}
      initialEngagementId={e}
    />
  );
}
