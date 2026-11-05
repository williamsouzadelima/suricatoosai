import {
  ShieldAlert,
  Search,
  FileText,
  LayoutDashboard,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

// Shared navigation model for the internal shell (desktop sidebar + mobile
// drawer). Kept in a plain module so both the server AppShell and the client
// MobileNav import the same source (the icons are isomorphic lucide refs).

export type ActiveKey =
  | "engagements"
  | "achados"
  | "relatorios"
  | "admin"
  | "seguranca";

export type NavEntry = {
  key: ActiveKey;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Só aparece para superadmin (allowlist SUPERADMIN_EMAILS). */
  requiresSuperadmin?: boolean;
};

export const NAV: { group: string; items: NavEntry[] }[] = [
  {
    group: "Operação",
    items: [
      {
        key: "engagements",
        href: "/engagements",
        label: "Engajamentos",
        icon: ShieldAlert,
      },
      {
        key: "achados",
        href: "/achados",
        label: "Achados",
        icon: Search,
      },
      {
        key: "relatorios",
        href: "/relatorios",
        label: "Relatórios",
        icon: FileText,
      },
    ],
  },
  {
    group: "Administração",
    items: [
      {
        key: "admin",
        href: "/admin",
        label: "Painel admin",
        icon: LayoutDashboard,
        requiresSuperadmin: true,
      },
      {
        key: "seguranca",
        href: "/seguranca",
        label: "Segurança",
        icon: ShieldCheck,
      },
    ],
  },
];

/**
 * NAV filtrado por acesso: esconde os itens `requiresSuperadmin` de quem não é
 * superadmin (antes o analista via "Painel admin", clicava e era EXPULSO do
 * shell pelo redirect do /admin). Grupos que ficam vazios somem.
 */
export function visibleNav(isSuperadmin: boolean) {
  return NAV.map((g) => ({
    group: g.group,
    items: g.items.filter((it) => !it.requiresSuperadmin || isSuperadmin),
  })).filter((g) => g.items.length > 0);
}
