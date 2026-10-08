import type { ReactNode } from "react";

export const metadata = {
  title: "Portal do Cliente — Suricatoos",
  description: "Acesso seguro aos seus relatórios de segurança.",
};

// Casca isolada do portal (sem a navegação interna do /admin ou /engagements).
// A sessão WorkOS é exigida pelo middleware; a autorização por cliente é
// deny-by-default nas rotas /api/portal/* (resolveMembership). Visual via tokens
// (app é dark-only) — mesma linguagem dos painéis internos.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">{children}</div>
  );
}
