import { redirect } from "next/navigation";
import { getInternalUser } from "@/lib/auth/require-internal";
import { EngagementsPanel } from "./EngagementsPanel";

export const metadata = {
  title: "Engajamentos — Suricatoos",
};

// Nunca cacheia: reflete evidência/achados ao vivo e é gated por staff interno.
export const dynamic = "force-dynamic";

export default async function EngagementsPage() {
  const staff = await getInternalUser();
  if (!staff) {
    // Não é staff interno (owner/analyst) ou não está logado: esconde tudo.
    redirect("/");
  }
  return <EngagementsPanel />;
}
