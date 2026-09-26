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
  Cpu,
  LineChart,
  Zap,
  MailPlus as InviteIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  StatCard,
  SectionHeader,
  MiniBarChart,
  formatDateTime,
  fmtNum,
} from "./_ui";
import { SystemHealthPanel } from "./SystemHealthPanel";

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

const fmtWeek = (ms: number) =>
  new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 font-display text-sm font-semibold text-foreground">
      {children}
    </h3>
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

  const activePct =
    data && data.users.total > 0
      ? `${Math.round((data.users.active / data.users.total) * 100)}% do total`
      : undefined;

  return (
    <div className="space-y-6">
      {/* Saúde do sistema */}
      <SystemHealthPanel />

      {/* Usuários */}
      <section>
        <GroupLabel>Usuários</GroupLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={UserCheck}
            label="Ativos"
            value={data?.users.active ?? 0}
            sub={activePct}
            tone="success"
            loading={loading}
          />
          <StatCard
            icon={MailPlus}
            label="Convidados"
            value={data?.users.invited ?? 0}
            sub="aguardando 1º acesso"
            tone="warning"
            loading={loading}
          />
          <StatCard
            icon={TrendingUp}
            label="Novos (7d)"
            value={data?.users.new7d ?? 0}
            sub={loading ? undefined : `${data?.users.new30d ?? 0} em 30 dias`}
            tone="primary"
            loading={loading}
          />
          <StatCard
            icon={Users}
            label="Total"
            value={data?.users.total ?? 0}
            sub={loading ? undefined : `${data?.users.revoked ?? 0} revogados`}
            tone="neutral"
            loading={loading}
          />
        </div>
      </section>

      {/* Crescimento — sempre renderiza o card */}
      {!loading && data && (
        <Card>
          <CardContent className="space-y-4">
            <SectionHeader
              icon={LineChart}
              title="Novos usuários por semana"
              description="Cadastros concluídos por semana."
            />
            <MiniBarChart
              data={data.signupsByWeek.map((w) => ({
                label: fmtWeek(w.start),
                count: w.count,
              }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Uso agregado */}
      <section>
        <GroupLabel>Uso agregado</GroupLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            icon={Activity}
            label="Requests"
            value={usage.loading ? 0 : fmtNum(usage.requests)}
            tone="primary"
            loading={usage.loading}
          />
          <StatCard
            icon={Cpu}
            label="Tokens"
            value={usage.loading ? 0 : fmtNum(usage.tokens)}
            tone="neutral"
            loading={usage.loading}
          />
          <StatCard
            icon={Coins}
            label="Custo"
            value={usage.loading ? 0 : `$${usage.cost.toFixed(2)}`}
            tone="success"
            loading={usage.loading}
          />
        </div>
      </section>

      {/* Comunicação */}
      <section>
        <GroupLabel>Comunicação</GroupLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            icon={Megaphone}
            label="Avisos ativos"
            value={data?.announcementsActive ?? 0}
            tone="primary"
            loading={loading}
          />
          <StatCard
            icon={Send}
            label="E-mails (30d)"
            value={loading ? 0 : fmtNum(data?.campaigns.sent30d ?? 0)}
            tone="success"
            loading={loading}
          />
          <StatCard
            icon={Send}
            label="Campanhas"
            value={data?.campaigns.count ?? 0}
            tone="neutral"
            loading={loading}
          />
        </div>
      </section>

      {/* Ações rápidas */}
      <Card>
        <CardContent className="space-y-3">
          <SectionHeader icon={Zap} title="Ações rápidas" />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate("acesso")}
            >
              <InviteIcon className="h-4 w-4" />
              Convidar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate("avisos")}
            >
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
        </CardContent>
      </Card>

      {/* Campanhas recentes */}
      {!loading && (data?.campaigns.recent.length ?? 0) > 0 && (
        <Card className="gap-0 py-0">
          <div className="border-b border-border p-5">
            <SectionHeader icon={Send} title="Últimas campanhas" />
          </div>
          <ul className="divide-y divide-border">
            {data!.campaigns.recent.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {c.subject}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.sent}/{c.total}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(c.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
