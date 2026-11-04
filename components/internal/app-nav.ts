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
