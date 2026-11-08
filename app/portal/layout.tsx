import type { ReactNode } from "react";

export const metadata = {
  title: "Portal do Cliente — Suricatoos",
  description: "Acesso seguro aos seus relatórios de segurança.",
};

// force-dynamic: a page é "use client" e usa useSearchParams (estado em
// ?c=/?e=/?tab=/?f=) sem Suspense — a config precisa ir no layout (Server
// Component), não na page. Mesmo motivo do operador (app/achados).
export const dynamic = "force-dynamic";

// Casca isolada do portal (sem a navegação interna do /admin ou /engagements).
// A sessão WorkOS é exigida pelo middleware; a autorização por cliente é
// deny-by-default nas rotas /api/portal/* (resolveMembership). Visual por tokens
// semânticos — claro + escuro de verdade (identidade "dark rail + light
// canvas"), mesma linguagem dos painéis internos.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">{children}</div>
  );
}
