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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HackerAISVG } from "@/components/icons/hackerai-svg";
import { UsersTable } from "./UsersTable";
import { AlertsTab } from "./AlertsTab";
import { AnnouncementsTab } from "./AnnouncementsTab";

type Status = "invited" | "active" | "revoked";

interface AllowlistEntry {
  email: string;
  status: Status;
  invited_by?: string;
  invited_at: number;
  activated_at?: number;
  revoked_at?: number;
  note?: string;
}

const STATUS: Record<
  Status,
  { label: string; dot: string; badge: string }
> = {
  active: {
    label: "Ativo",
    dot: "bg-emerald-500",
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  invited: {
    label: "Convidado",
    dot: "bg-amber-500",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  revoked: {
    label: "Revogado",
    dot: "bg-zinc-400",
    badge: "border-border bg-muted text-muted-foreground",
  },
};

const fmtDate = (ms?: number) =>
  ms
    ? new Date(ms).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={accent}>{icon}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
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
  const [tab, setTab] = useState<
    "acesso" | "usuarios" | "alertas" | "avisos"
  >("acesso");

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
        `Grandfather: ${data.inserted} adicionados, ${data.skipped} já existiam (${data.totalWorkosUsers} no WorkOS).`,
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no backfill.");
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

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {/* Brand */}
        <div className="mb-6">
          <HackerAISVG theme="dark" scale={0.16} />
        </div>

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Controle de acesso
              </h1>
              <p className="text-sm text-muted-foreground">{adminEmail}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                inviteOnlyEnabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  inviteOnlyEnabled ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              Convite {inviteOnlyEnabled ? "ligado" : "desligado"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void backfill()}
              disabled={backfilling}
            >
              <UserCheck className="h-4 w-4" />
              {backfilling ? "Processando…" : "Grandfather"}
            </Button>
          </div>
        </div>

        {!inviteOnlyEnabled && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
            Acesso por convite está <strong>desligado</strong>. Convites e
            atividade são registrados normalmente, mas qualquer pessoa ainda
            consegue entrar até a flag ser ligada.
          </div>
        )}

        {/* Tabs */}
        <div className="mt-6 inline-flex gap-1 rounded-lg border bg-card p-1">
          <button
            type="button"
            onClick={() => setTab("acesso")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "acesso"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Convites &amp; acesso
          </button>
          <button
            type="button"
            onClick={() => setTab("usuarios")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "usuarios"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Usuários
          </button>
          <button
            type="button"
            onClick={() => setTab("alertas")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "alertas"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Bell className="h-3.5 w-3.5" />
            Alertas
          </button>
          <button
            type="button"
            onClick={() => setTab("avisos")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "avisos"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Megaphone className="h-3.5 w-3.5" />
            Avisos
          </button>
        </div>

        {tab === "usuarios" ? (
          <div className="mt-6">
            <UsersTable />
          </div>
        ) : tab === "alertas" ? (
          <AlertsTab adminEmail={adminEmail} />
        ) : tab === "avisos" ? (
          <AnnouncementsTab />
        ) : (
          <>
        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Total"
            value={entries.length}
            accent="text-muted-foreground"
          />
          <StatCard
            icon={<UserCheck className="h-4 w-4" />}
            label="Ativos"
            value={counts.active}
            accent="text-emerald-500"
          />
          <StatCard
            icon={<MailPlus className="h-4 w-4" />}
            label="Convidados"
            value={counts.invited}
            accent="text-amber-500"
          />
          <StatCard
            icon={<Ban className="h-4 w-4" />}
            label="Revogados"
            value={counts.revoked}
            accent="text-muted-foreground"
          />
        </div>

        {/* Invite */}
        <div className="mt-6 rounded-xl border bg-card p-5">
          <h2 className="text-base font-semibold">Convidar</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Adiciona à lista e envia um convite (link de cadastro) por e-mail.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
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
        </div>

        {/* List */}
        <div className="mt-6 rounded-xl border bg-card">
          <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold">Lista de acesso</h2>
            <div className="relative sm:w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar e-mail ou nota…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                {entries.length === 0
                  ? "Ninguém na lista ainda. Convide alguém acima."
                  : "Nenhum resultado para a busca."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-3 font-medium">E-mail</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Convidado</th>
                    <th className="px-5 py-3 font-medium">Ativo desde</th>
                    <th className="px-5 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const s = STATUS[e.status];
                    return (
                      <tr
                        key={e.email}
                        className="border-b transition-colors last:border-0 hover:bg-muted/40"
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
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.badge}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${s.dot}`}
                            />
                            {s.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {fmtDate(e.invited_at)}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {fmtDate(e.activated_at)}
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
        </div>
          </>
        )}
      </div>
    </div>
  );
}
