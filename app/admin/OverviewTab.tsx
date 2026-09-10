"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  UserCheck,
  MailPlus,
  TrendingUp,
  Activity,
  Coins,
  Megaphone,
  Send,
  MailPlus as InviteIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type AdminTab = "acesso" | "usuarios" | "alertas" | "avisos" | "marketing";

interface Overview {
  users: {
    total: number;
    active: number;
    invited: number;
    revoked: number;
    new7d: number;
    new30d: number;
  };
  announcementsActive: number;
  campaigns: {
    count: number;
    sent30d: number;
    recent: {
      subject: string;
      segment: string;
      sent: number;
      total: number;
      created_at: number;
    }[];
  };
  signupsByWeek: { start: number; count: number }[];
}

const fmtNum = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n);

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtWeek = (ms: number) =>
  new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function Stat({
  icon,
  label,
  value,
  sub,
  accent = "text-muted-foreground",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={accent}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function OverviewTab({
  onNavigate,
}: {
  onNavigate: (tab: AdminTab) => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<{
    requests: number;
    tokens: number;
    cost: number;
    loading: boolean;
  }>({ requests: 0, tokens: 0, cost: 0, loading: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    setUsage((u) => ({ ...u, loading: true }));
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const rows: {
        requests: number;
        inputTokens: number;
        outputTokens: number;
        costDollars: number;
      }[] = d.users ?? [];
      const agg = rows.reduce(
        (a, r) => {
          a.requests += r.requests || 0;
          a.tokens += (r.inputTokens || 0) + (r.outputTokens || 0);
          a.cost += r.costDollars || 0;
          return a;
        },
        { requests: 0, tokens: 0, cost: 0 },
      );
      setUsage({ ...agg, loading: false });
    } catch {
      setUsage((u) => ({ ...u, loading: false }));
    }
  }, []);

  useEffect(() => {
    void load();
    void loadUsage();
  }, [load, loadUsage]);

  return (
    <div className="mt-6 space-y-4">
      {/* Usuários */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Usuários
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            icon={<UserCheck className="h-4 w-4" />}
            label="Ativos"
            value={loading ? "—" : data?.users.active ?? 0}
            accent="text-success"
          />
          <Stat
            icon={<MailPlus className="h-4 w-4" />}
            label="Convidados"
            value={loading ? "—" : data?.users.invited ?? 0}
            accent="text-warning"
          />
          <Stat
            icon={<TrendingUp className="h-4 w-4" />}
            label="Novos (7d)"
            value={loading ? "—" : data?.users.new7d ?? 0}
            accent="text-primary"
          />
          <Stat
            icon={<Users className="h-4 w-4" />}
            label="Total"
            value={loading ? "—" : data?.users.total ?? 0}
            sub={loading ? undefined : `${data?.users.new30d ?? 0} novos em 30d`}
          />
        </div>
      </div>

      {/* Crescimento */}
      {!loading && data && data.signupsByWeek.length > 0 && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Novos usuários por semana
          </h3>
          {(() => {
            const weeks = data.signupsByWeek;
            const max = Math.max(1, ...weeks.map((w) => w.count));
            return (
              <>
                <div className="flex h-28 items-end gap-1.5">
                  {weeks.map((w, i) => (
                    <div
                      key={i}
                      className="group flex flex-1 flex-col items-center justify-end gap-1"
                      title={`${w.count} em ${fmtWeek(w.start)}`}
                    >
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {w.count > 0 ? w.count : ""}
                      </span>
                      <div
                        className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary"
                        style={{
                          height: `${Math.max(3, (w.count / max) * 100)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                  <span>{fmtWeek(weeks[0].start)}</span>
                  <span>agora</span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Uso */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Uso agregado
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            icon={<Activity className="h-4 w-4" />}
            label="Requests"
            value={usage.loading ? "…" : fmtNum(usage.requests)}
            accent="text-primary"
          />
          <Stat
            icon={<Activity className="h-4 w-4" />}
            label="Tokens"
            value={usage.loading ? "…" : fmtNum(usage.tokens)}
          />
          <Stat
            icon={<Coins className="h-4 w-4" />}
            label="Custo"
            value={usage.loading ? "…" : `$${usage.cost.toFixed(2)}`}
            accent="text-success"
          />
        </div>
      </div>

      {/* Engajamento */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Comunicação
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            icon={<Megaphone className="h-4 w-4" />}
            label="Avisos ativos"
            value={loading ? "—" : data?.announcementsActive ?? 0}
            accent="text-primary"
          />
          <Stat
            icon={<Send className="h-4 w-4" />}
            label="E-mails (30d)"
            value={loading ? "—" : fmtNum(data?.campaigns.sent30d ?? 0)}
            accent="text-success"
          />
          <Stat
            icon={<Send className="h-4 w-4" />}
            label="Campanhas"
            value={loading ? "—" : data?.campaigns.count ?? 0}
          />
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Ações rápidas</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onNavigate("acesso")}>
            <InviteIcon className="h-4 w-4" />
            Convidar
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("avisos")}>
            <Megaphone className="h-4 w-4" />
            Novo aviso
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate("marketing")}
          >
            <Send className="h-4 w-4" />
            Nova campanha
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate("usuarios")}
          >
            <Users className="h-4 w-4" />
            Ver usuários
          </Button>
        </div>
      </div>

      {/* Campanhas recentes */}
      {!loading && (data?.campaigns.recent.length ?? 0) > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="border-b p-4">
            <h3 className="text-sm font-semibold">Últimas campanhas</h3>
          </div>
          <ul className="divide-y">
            {data!.campaigns.recent.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {c.subject}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.sent}/{c.total}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {fmtDate(c.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
