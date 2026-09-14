"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Users,
  UserCheck,
  MailPlus,
  Ban,
  Search,
  ShieldCheck,
  RefreshCw,
  Bell,
  Megaphone,
  Send,
  LayoutDashboard,
  Download,
  ScrollText,
  DollarSign,
  Wallet,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toCsv, downloadCsv, csvName } from "@/lib/utils/csv";
import { HackerAISVG } from "@/components/icons/hackerai-svg";
import { UsersTable } from "./UsersTable";
import { AlertsTab } from "./AlertsTab";
import { AnnouncementsTab } from "./AnnouncementsTab";
import { MarketingTab } from "./MarketingTab";
import { OverviewTab } from "./OverviewTab";
import { AuditTab } from "./AuditTab";
import { TaskCostsTab } from "./TaskCostsTab";
import { BudgetTab } from "./BudgetTab";
import {
  StatCard,
  StatusBadge,
  SectionHeader,
  EmptyState,
  Callout,
  formatDateTime,
  type Tone,
} from "./_ui";

type Status = "invited" | "active" | "revoked";

type Tab =
  | "overview"
  | "acesso"
  | "usuarios"
  | "alertas"
  | "avisos"
  | "marketing"
  | "auditoria"
  | "custos"
  | "orcamentos";

interface AllowlistEntry {
  email: string;
  status: Status;
  invited_by?: string;
  invited_at: number;
  activated_at?: number;
  revoked_at?: number;
  note?: string;
}

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  active: { label: "Ativo", tone: "success" },
  invited: { label: "Convidado", tone: "warning" },
  revoked: { label: "Revogado", tone: "neutral" },
};

const NAV_GROUPS: { title: string; items: { id: Tab; label: string; icon: LucideIcon }[] }[] = [
  { title: "Geral", items: [{ id: "overview", label: "Visão geral", icon: LayoutDashboard }] },
  {
    title: "Acesso",
    items: [
      { id: "acesso", label: "Convites & acesso", icon: MailPlus },
      { id: "usuarios", label: "Usuários", icon: Users },
    ],
  },
  {
    title: "Comunicação",
    items: [
      { id: "alertas", label: "Alertas", icon: Bell },
      { id: "avisos", label: "Avisos", icon: Megaphone },
      { id: "marketing", label: "Marketing", icon: Send },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { id: "custos", label: "Custos", icon: DollarSign },
      { id: "orcamentos", label: "Orçamentos", icon: Wallet },
    ],
  },
  { title: "Sistema", items: [{ id: "auditoria", label: "Auditoria", icon: ScrollText }] },
];

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items);

function NavItem({
  item,
  active,
  onClick,
}: {
  item: { id: Tab; label: string; icon: LucideIcon };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand" />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
    </button>
  );
}

export function AdminPanel({
  adminEmail,
  inviteOnlyEnabled,
}: {
  adminEmail: string;
  inviteOnlyEnabled: boolean;
}) {
  const [entries, setEntries] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/access", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (error) {
      toast.error("Falha ao carregar a lista de acesso.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = useCallback(async () => {
    const target = email.trim().toLowerCase();
    if (!target || !target.includes("@")) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(
        data.invitationSent
          ? `Convite enviado para ${target}.`
          : `${target} adicionado (e-mail de convite não enviado).`,
      );
      setEmail("");
      setNote("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao convidar.");
    } finally {
      setInviting(false);
    }
  }, [email, note, load]);

  const act = useCallback(
    async (targetEmail: string, action: "revoke" | "reinvite") => {
      setBusyEmail(targetEmail);
      try {
        const res = await fetch("/api/admin/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: targetEmail, action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        toast.success(
          action === "revoke"
            ? `Acesso revogado: ${targetEmail}`
            : `Reconvidado: ${targetEmail}`,
        );
        await load();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Falha na operação.",
        );
      } finally {
        setBusyEmail(null);
      }
    },
    [load],
  );

  const backfill = useCallback(async () => {
    if (
      !window.confirm(
        "Marcar TODOS os usuários atuais do WorkOS como 'ativos' na lista? " +
          "Faça isto uma vez, antes de ligar o acesso por convite.",
      )
    ) {
      return;
    }
    setBackfilling(true);
    try {
      const res = await fetch("/api/admin/backfill", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(
        `Importados: ${data.inserted} adicionados, ${data.skipped} já existiam (${data.totalWorkosUsers} no WorkOS).`,
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na importação.");
    } finally {
      setBackfilling(false);
    }
  }, [load]);

  const counts = useMemo(
    () =>
      entries.reduce(
        (acc, e) => {
          acc[e.status] += 1;
          return acc;
        },
        { active: 0, invited: 0, revoked: 0 } as Record<Status, number>,
      ),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.email.toLowerCase().includes(q) ||
        (e.note ?? "").toLowerCase().includes(q),
    );
  }, [entries, query]);

  const exportCsv = useCallback(() => {
    const rows = filtered.map((e) => ({
      email: e.email,
      status: e.status,
      convidado_por: e.invited_by ?? "",
      convidado_em: e.invited_at ? new Date(e.invited_at).toISOString() : "",
      ativo_desde: e.activated_at ? new Date(e.activated_at).toISOString() : "",
      revogado_em: e.revoked_at ? new Date(e.revoked_at).toISOString() : "",
      nota: e.note ?? "",
    }));
    downloadCsv(
      csvName("acesso"),
      toCsv(rows, [
        { key: "email", label: "E-mail" },
        { key: "status", label: "Status" },
        { key: "convidado_por", label: "Convidado por" },
        { key: "convidado_em", label: "Convidado em" },
        { key: "ativo_desde", label: "Ativo desde" },
        { key: "revogado_em", label: "Revogado em" },
        { key: "nota", label: "Nota" },
      ]),
    );
  }, [filtered]);

  const activeLabel = ALL_NAV.find((n) => n.id === tab)?.label ?? "Visão geral";
  const wide = tab === "custos" || tab === "usuarios";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border px-5">
          <HackerAISVG scale={0.14} />
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="px-3 pb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem
                    key={item.id}
                    item={item}
                    active={tab === item.id}
                    onClick={() => setTab(item.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{adminEmail}</div>
              <div className="text-xs text-muted-foreground">Superadmin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="lg:hidden">
              <HackerAISVG scale={0.12} />
            </span>
            <h1 className="hidden truncate font-display text-lg font-semibold tracking-tight lg:block">
              {activeLabel}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge
              tone={inviteOnlyEnabled ? "success" : "warning"}
              label={`Convite ${inviteOnlyEnabled ? "ligado" : "desligado"}`}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void backfill()}
              disabled={backfilling}
              title="Marca todos os usuários já existentes no WorkOS como ativos na lista (operação única, antes de ligar o acesso por convite)."
            >
              <UserCheck className="h-4 w-4" />
              <span className="hidden sm:inline">
                {backfilling ? "Processando…" : "Importar existentes"}
              </span>
            </Button>
          </div>
        </header>

        {/* Nav horizontal (mobile) */}
        <div className="border-b border-border bg-card px-2 lg:hidden">
          <div className="flex gap-1 overflow-x-auto py-2">
            {ALL_NAV.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <main className="flex-1">
          <div className={cn("mx-auto w-full px-4 py-8 sm:px-6", wide ? "max-w-[96rem]" : "max-w-6xl")}>
            {!inviteOnlyEnabled && (
              <div className="mb-6">
                <Callout tone="warning" icon={AlertTriangle}>
                  Acesso por convite está <strong>desligado</strong>. Convites e
                  atividade são registrados normalmente, mas qualquer pessoa
                  ainda consegue entrar até a flag ser ligada.
                </Callout>
              </div>
            )}

            {tab === "overview" ? (
              <OverviewTab onNavigate={(t) => setTab(t as Tab)} />
            ) : tab === "usuarios" ? (
              <UsersTable />
            ) : tab === "alertas" ? (
              <AlertsTab adminEmail={adminEmail} />
            ) : tab === "avisos" ? (
              <AnnouncementsTab />
            ) : tab === "marketing" ? (
              <MarketingTab />
            ) : tab === "auditoria" ? (
              <AuditTab />
            ) : tab === "custos" ? (
              <TaskCostsTab />
            ) : tab === "orcamentos" ? (
              <BudgetTab adminEmail={adminEmail} />
            ) : (
              /* ---- Convites & acesso ---- */
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard
                    icon={UserCheck}
                    label="Ativos"
                    value={counts.active}
                    tone="success"
                  />
                  <StatCard
                    icon={MailPlus}
                    label="Convidados"
                    value={counts.invited}
                    tone="warning"
                  />
                  <StatCard
                    icon={Ban}
                    label="Revogados"
                    value={counts.revoked}
                    tone="neutral"
                  />
                  <StatCard
                    icon={Users}
                    label="Total"
                    value={entries.length}
                    tone="primary"
                  />
                </div>

                {/* Convidar */}
                <Card>
                  <CardContent className="space-y-4">
                    <SectionHeader
                      icon={MailPlus}
                      title="Convidar"
                      description="Adiciona à lista e envia um convite (link de cadastro) por e-mail."
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        type="email"
                        placeholder="email@empresa.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void invite();
                        }}
                        className="flex-1"
                      />
                      <Input
                        type="text"
                        placeholder="nota (opcional)"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="sm:w-52"
                      />
                      <Button onClick={() => void invite()} disabled={inviting}>
                        <MailPlus className="h-4 w-4" />
                        {inviting ? "Enviando…" : "Convidar"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Lista de acesso */}
                <Card className="gap-0 py-0">
                  <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                    <SectionHeader
                      icon={Users}
                      title="Lista de acesso"
                      count={filtered.length}
                    />
                    <div className="flex items-center gap-2">
                      <div className="relative sm:w-72">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Buscar e-mail ou nota…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportCsv}
                        disabled={filtered.length === 0}
                        title="Exportar CSV"
                      >
                        <Download className="h-4 w-4" />
                        CSV
                      </Button>
                    </div>
                  </div>

                  {loading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      Carregando…
                    </div>
                  ) : filtered.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title={
                        entries.length === 0
                          ? "Ninguém na lista ainda"
                          : "Nenhum resultado"
                      }
                      description={
                        entries.length === 0
                          ? "Convide alguém pelo formulário acima."
                          : "Ajuste os termos da busca."
                      }
                    />
                  ) : (
                    <div className="min-w-0 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                            <th className="px-5 py-3 font-medium">E-mail</th>
                            <th className="px-5 py-3 font-medium">Status</th>
                            <th className="px-5 py-3 font-medium">Convidado</th>
                            <th className="px-5 py-3 font-medium">Ativo desde</th>
                            <th className="px-5 py-3 text-right font-medium">
                              Ações
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((e) => {
                            const s = STATUS[e.status];
                            return (
                              <tr
                                key={e.email}
                                className="border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                              >
                                <td className="px-5 py-3">
                                  <div className="font-medium">{e.email}</div>
                                  {e.note && (
                                    <div className="text-xs text-muted-foreground">
                                      {e.note}
                                    </div>
                                  )}
                                </td>
                                <td className="px-5 py-3">
                                  <StatusBadge tone={s.tone} label={s.label} />
                                </td>
                                <td className="px-5 py-3 text-muted-foreground">
                                  {formatDateTime(e.invited_at)}
                                </td>
                                <td className="px-5 py-3 text-muted-foreground">
                                  {formatDateTime(e.activated_at)}
                                </td>
                                <td className="px-5 py-3 text-right">
                                  {e.status === "revoked" ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={busyEmail === e.email}
                                      onClick={() => void act(e.email, "reinvite")}
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                      Reconvidar
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      disabled={busyEmail === e.email}
                                      onClick={() => void act(e.email, "revoke")}
                                    >
                                      <Ban className="h-3.5 w-3.5" />
                                      Revogar
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
