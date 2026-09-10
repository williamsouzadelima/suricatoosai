"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, Wallet, AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

interface Settings {
  enabled: boolean;
  per_task_enabled: boolean;
  per_task_cap_dollars?: number;
  per_task_block: boolean;
  per_user_enabled: boolean;
  per_user_cap_dollars?: number;
  per_user_period: "day" | "month";
  per_user_block: boolean;
  warn_threshold_pct?: number;
  alert_teams: boolean;
  alert_email: boolean;
  updated_by?: string;
  updated_at?: number;
}

interface Override {
  user_id: string;
  email?: string;
  per_task_cap_dollars?: number;
  per_user_cap_dollars?: number;
  disabled?: boolean;
  note?: string;
}

const capStr = (n?: number) => (typeof n === "number" ? String(n) : "");

export function BudgetTab({ adminEmail }: { adminEmail: string }) {
  const [enabled, setEnabled] = useState(false);
  const [taskEnabled, setTaskEnabled] = useState(false);
  const [taskCap, setTaskCap] = useState("");
  const [taskBlock, setTaskBlock] = useState(false);
  const [userEnabled, setUserEnabled] = useState(false);
  const [userCap, setUserCap] = useState("");
  const [userPeriod, setUserPeriod] = useState<"day" | "month">("month");
  const [userBlock, setUserBlock] = useState(false);
  const [warnPct, setWarnPct] = useState("80");
  const [alertTeams, setAlertTeams] = useState(false);
  const [alertEmail, setAlertEmail] = useState(false);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [teamsConfigured, setTeamsConfigured] = useState(true);
  const [updatedBy, setUpdatedBy] = useState<string | undefined>();
  const [updatedAt, setUpdatedAt] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Novo override
  const [ovUserId, setOvUserId] = useState("");
  const [ovEmail, setOvEmail] = useState("");
  const [ovTaskCap, setOvTaskCap] = useState("");
  const [ovUserCap, setOvUserCap] = useState("");
  const [ovDisabled, setOvDisabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/budget", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const s: Settings = data.settings ?? {};
      setEnabled(!!s.enabled);
      setTaskEnabled(!!s.per_task_enabled);
      setTaskCap(capStr(s.per_task_cap_dollars));
      setTaskBlock(!!s.per_task_block);
      setUserEnabled(!!s.per_user_enabled);
      setUserCap(capStr(s.per_user_cap_dollars));
      setUserPeriod(s.per_user_period === "day" ? "day" : "month");
      setUserBlock(!!s.per_user_block);
      setWarnPct(s.warn_threshold_pct ? String(s.warn_threshold_pct) : "80");
      setAlertTeams(!!s.alert_teams);
      setAlertEmail(!!s.alert_email);
      setOverrides(data.overrides ?? []);
      setEmailConfigured(!!data.emailConfigured);
      setTeamsConfigured(!!data.teamsConfigured);
      setUpdatedBy(s.updated_by);
      setUpdatedAt(s.updated_at);
    } catch (e) {
      toast.error("Falha ao carregar orçamentos.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          settings: {
            enabled,
            per_task_enabled: taskEnabled,
            per_task_cap_dollars: taskCap.trim() === "" ? undefined : Number(taskCap),
            per_task_block: taskBlock,
            per_user_enabled: userEnabled,
            per_user_cap_dollars: userCap.trim() === "" ? undefined : Number(userCap),
            per_user_period: userPeriod,
            per_user_block: userBlock,
            warn_threshold_pct: warnPct.trim() === "" ? undefined : Number(warnPct),
            alert_teams: alertTeams,
            alert_email: alertEmail,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Orçamentos salvos.");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }, [
    enabled, taskEnabled, taskCap, taskBlock, userEnabled, userCap, userPeriod,
    userBlock, warnPct, alertTeams, alertEmail, load,
  ]);

  const addOverride = useCallback(async () => {
    if (!ovUserId.trim()) {
      toast.error("Informe o user_id (veja na aba Usuários).");
      return;
    }
    try {
      const res = await fetch("/api/admin/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-override",
          override: {
            userId: ovUserId.trim(),
            email: ovEmail.trim() || undefined,
            perTaskCapDollars: ovTaskCap.trim() === "" ? undefined : Number(ovTaskCap),
            perUserCapDollars: ovUserCap.trim() === "" ? undefined : Number(ovUserCap),
            disabled: ovDisabled,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Override salvo.");
      setOvUserId(""); setOvEmail(""); setOvTaskCap(""); setOvUserCap(""); setOvDisabled(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no override.");
    }
  }, [ovUserId, ovEmail, ovTaskCap, ovUserCap, ovDisabled, load]);

  const removeOverride = useCallback(
    async (userId: string) => {
      try {
        const res = await fetch("/api/admin/budget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove-override", userId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        void load();
      } catch (e) {
        toast.error("Falha ao remover override.");
        console.error(e);
      }
    },
    [load],
  );

  if (loading) {
    return (
      <div className="mt-6 rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Orçamentos por task e usuário</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Ativar controle</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <div className="space-y-5 p-5">
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            Threshold sobre o <strong>custo real</strong> (OpenRouter). Padrão de fábrica:
            desligado. Com <strong>bloqueio</strong> ligado, um novo run é{" "}
            <strong>recusado</strong> quando o custo real já acumulado (da task ou do usuário
            no período) passou do teto — <strong>não corta</strong> um run em andamento (corte
            mid-run por task é refinamento futuro). Alertas disparam a partir do % de aviso.
          </p>

          {/* POR TASK */}
          <fieldset className="rounded-lg border p-4" disabled={!enabled}>
            <div className="flex items-center justify-between">
              <legend className="px-1 text-sm font-semibold">Por task (chat)</legend>
              <Switch checked={taskEnabled} onCheckedChange={setTaskEnabled} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-sm text-muted-foreground">Teto (US$)</label>
              <Input
                type="number" step="0.01" min="0" className="w-32"
                placeholder="ex.: 5.00" value={taskCap}
                onChange={(e) => setTaskCap(e.target.value)}
              />
              <label className="ml-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={taskBlock} onCheckedChange={setTaskBlock} />
                Recusar novo run se a task passou do teto
              </label>
            </div>
          </fieldset>

          {/* POR USUÁRIO */}
          <fieldset className="rounded-lg border p-4" disabled={!enabled}>
            <div className="flex items-center justify-between">
              <legend className="px-1 text-sm font-semibold">Por usuário</legend>
              <Switch checked={userEnabled} onCheckedChange={setUserEnabled} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="text-sm text-muted-foreground">Teto (US$)</label>
              <Input
                type="number" step="0.01" min="0" className="w-32"
                placeholder="ex.: 50.00" value={userCap}
                onChange={(e) => setUserCap(e.target.value)}
              />
              <label className="text-sm text-muted-foreground">por</label>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={userPeriod}
                onChange={(e) => setUserPeriod(e.target.value === "day" ? "day" : "month")}
              >
                <option value="month">mês</option>
                <option value="day">dia</option>
              </select>
              <label className="ml-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={userBlock} onCheckedChange={setUserBlock} />
                Recusar iniciar novo run
              </label>
            </div>
          </fieldset>

          {/* AVISO + CANAIS */}
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Alertar a partir de</label>
              <Input
                type="number" min="1" max="100" className="w-20"
                value={warnPct} onChange={(e) => setWarnPct(e.target.value)}
              />
              <span className="text-sm text-muted-foreground">% do teto</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={alertTeams} onCheckedChange={setAlertTeams} /> Teams
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={alertEmail} onCheckedChange={setAlertEmail} /> E-mail
            </label>
          </div>
          {(alertTeams && !teamsConfigured) || (alertEmail && !emailConfigured) ? (
            <p className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              Configure os destinos (webhook Teams / e-mail) na aba <strong>Alertas</strong> — os
              alertas de orçamento reusam esses canais.
            </p>
          ) : null}

          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-xs text-muted-foreground">
              {updatedAt
                ? `Última alteração: ${updatedBy ?? "?"} em ${new Date(updatedAt).toLocaleString("pt-BR")}`
                : "Nunca salvo."}
            </span>
            <Button onClick={() => void save()} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      </div>

      {/* OVERRIDES */}
      <div className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h3 className="text-sm font-semibold">Exceções por usuário</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Eleve o teto de um usuário com engajamento pesado, ou isente-o do controle.
            O <code>user_id</code> aparece na aba Usuários.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-b p-4">
          <Input placeholder="user_id" className="w-56" value={ovUserId} onChange={(e) => setOvUserId(e.target.value)} />
          <Input placeholder="e-mail (rótulo)" className="w-52" value={ovEmail} onChange={(e) => setOvEmail(e.target.value)} />
          <Input type="number" step="0.01" placeholder="teto task $" className="w-28" value={ovTaskCap} onChange={(e) => setOvTaskCap(e.target.value)} />
          <Input type="number" step="0.01" placeholder="teto usuário $" className="w-32" value={ovUserCap} onChange={(e) => setOvUserCap(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={ovDisabled} onCheckedChange={setOvDisabled} /> isento
          </label>
          <Button variant="outline" size="sm" onClick={() => void addOverride()}>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </div>
        {overrides.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma exceção.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2 font-medium">Usuário</th>
                  <th className="px-5 py-2 text-right font-medium">Teto task</th>
                  <th className="px-5 py-2 text-right font-medium">Teto usuário</th>
                  <th className="px-5 py-2 font-medium">Isento</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.user_id} className="border-b last:border-0">
                    <td className="px-5 py-2">
                      <div className="font-medium">{o.email ?? o.user_id}</div>
                      {o.email && <div className="text-xs text-muted-foreground">{o.user_id}</div>}
                    </td>
                    <td className="px-5 py-2 text-right">{capStr(o.per_task_cap_dollars) ? `$${o.per_task_cap_dollars}` : "—"}</td>
                    <td className="px-5 py-2 text-right">{capStr(o.per_user_cap_dollars) ? `$${o.per_user_cap_dollars}` : "—"}</td>
                    <td className="px-5 py-2">{o.disabled ? "sim" : "—"}</td>
                    <td className="px-5 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => void removeOverride(o.user_id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="px-1 text-xs text-muted-foreground">Admin: {adminEmail}</p>
    </div>
  );
}
