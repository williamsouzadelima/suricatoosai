import * as React from "react";
import Link from "next/link";
import {
  ShieldAlert,
  LayoutDashboard,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Casca compartilhada dos painéis internos (/admin, /engagements): sidebar navy
 * premium + top bar + cabeçalho de página. Fonte única do visual "nível agência".
 */

type ActiveKey = "engagements" | "admin";

type NavEntry = {
  key: ActiveKey;
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV: { group: string; items: NavEntry[] }[] = [
  {
    group: "Operação",
    items: [
      {
        key: "engagements",
        href: "/engagements",
        label: "Engajamentos",
        icon: ShieldAlert,
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
    ],
  },
];

function NavLink({ item, active }: { item: NavEntry; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
        active
          ? "bg-gradient-to-r from-primary/25 to-primary/[0.06] text-white shadow-[inset_0_0_0_1px_rgba(93,132,240,0.28)]"
          : "text-[#aebbd2] hover:bg-white/5 hover:text-[#e6edf8]",
      )}
    >
      {active && (
        <span className="absolute -left-3.5 bottom-2 top-2 w-[3px] rounded-r bg-brand" />
      )}
      <Icon className="h-[17px] w-[17px] shrink-0 opacity-90" />
      {item.label}
    </Link>
  );
}

function initials(email?: string): string {
  if (!email) return "SC";
  const name = email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const s = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "");
  return s.toUpperCase() || "SC";
}

export function AppShell({
  active,
  title,
  description,
  icon: Icon,
  breadcrumb,
  actions,
  topbarRight,
  userEmail,
  userRole,
  children,
}: {
  active: ActiveKey;
  title: string;
  description?: string;
  icon: LucideIcon;
  breadcrumb?: string[];
  actions?: React.ReactNode;
  topbarRight?: React.ReactNode;
  userEmail?: string;
  userRole?: string;
  children: React.ReactNode;
}) {
  const crumbs = breadcrumb ?? [];
  return (
    <div className="grid h-screen grid-cols-1 bg-background md:grid-cols-[248px_1fr]">
      {/* Sidebar */}
      <aside className="internal-sidebar hidden flex-col gap-1 px-3.5 py-[18px] text-[#c7d3e6] md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-4 pt-1.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-gradient-to-br from-primary to-[#3f6ef0] font-display text-sm font-extrabold text-white shadow-[0_6px_16px_-6px_rgba(36,86,230,0.7)]">
            S
          </div>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-bold text-white">
              Suricatoos
            </div>
            <div className="-mt-0.5 text-[11px] text-[#7d8ca8]">
              Offensive Security
            </div>
          </div>
        </div>

        {NAV.map((g) => (
          <div key={g.group}>
            <div className="px-2.5 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#5f7291]">
              {g.group}
            </div>
            {g.items.map((it) => (
              <NavLink key={it.key} item={it} active={active === it.key} />
            ))}
          </div>
        ))}

        <Link
          href="/"
          className="mt-2 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13px] font-medium text-[#8595b0] transition-colors hover:bg-white/5 hover:text-[#e6edf8]"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar ao app
        </Link>

        <div className="mt-auto flex items-center gap-2.5 rounded-[10px] border border-white/[0.06] bg-white/[0.04] p-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#3f6ef0] to-brand text-[11px] font-bold text-white">
            {initials(userEmail)}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12.5px] font-semibold text-[#e6edf8]">
              {userEmail ?? "Staff"}
            </div>
            <div className="text-[11px] text-[#7d8ca8]">
              {userRole ?? "interno"}
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 overflow-auto">
        <div className="internal-topbar sticky top-0 z-10 flex items-center gap-3.5 border-b border-border px-4 py-3.5 md:px-7">
          <div className="flex min-w-0 items-center gap-1.5 truncate text-[13px] text-muted-foreground">
            <span className="hidden sm:inline">Suricatoos</span>
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                <span className="hidden text-border sm:inline">/</span>
                <span
                  className={cn(
                    "truncate",
                    i === crumbs.length - 1 && "font-semibold text-foreground",
                  )}
                >
                  {c}
                </span>
              </React.Fragment>
            ))}
          </div>
          {topbarRight && (
            <div className="ml-auto flex items-center gap-2">{topbarRight}</div>
          )}
        </div>

        <div className="mx-auto w-full max-w-[1180px] px-4 pb-14 pt-6 md:px-7">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex items-start gap-4">
              <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-primary/15 to-[#3f6ef0]/[0.08] text-primary shadow-[inset_0_0_0_1px_rgba(36,86,230,0.14)]">
                <Icon className="h-[22px] w-[22px]" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-[23px] font-bold leading-tight tracking-tight text-foreground">
                  {title}
                </h1>
                {description && (
                  <p className="mt-0.5 max-w-2xl text-[13.5px] text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>
            {actions && (
              <div className="flex items-center gap-2 sm:ml-auto">
                {actions}
              </div>
            )}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
