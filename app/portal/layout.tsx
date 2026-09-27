import type { ReactNode } from "react";

export const metadata = {
  title: "Portal do Cliente",
  description: "Acesso seguro aos seus relatórios de segurança.",
};

// Casca isolada do portal (sem a navegação interna do /admin ou /engagements).
// A sessão WorkOS é exigida pelo middleware; a autorização por cliente é
// deny-by-default nas rotas /api/portal/*.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f8fc] text-[#0e1b2e]">{children}</div>
  );
}
