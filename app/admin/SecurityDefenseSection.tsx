"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, Ban, Plus, Trash2, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SectionHeader,
  StatusBadge,
  Callout,
  EmptyState,
  formatDateTime,
} from "./_ui";

interface Block {
  id: string;
  type: string;
  value: string;
  reason: string | null;
  source: string;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number | null;
  hits: number;
}
interface Settings {
  enforcement_mode: "shadow" | "enforce";
  auto_block_enabled: boolean;
  auto_suspend_users: boolean;
  kill_switch: boolean;
  req_burst_window_s: number;
  req_burst_max: number;
  deny_burst_max: number;
  path_scan_distinct_max: number;
  auto_block_ttl_s: number;
  safelist_ips: string[];
  safelist_user_ids: string[];
}

export function SecurityDefenseSection() {
  const [forbidden, setForbidden] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [newType, setNewType] = useState("ip");
  const [newValue, setNewValue] = useState("");
  const [newReason, setNewReason] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        fetch("/api/admin/security/settings", { cache: "no-store" }),
        fetch("/api/admin/security/blocklist", { cache: "no-store" }),
      ]);
      if (s.status === 403 || b.status === 403) {
        setForbidden(true);
        return;
      }
      if (s.ok) setSettings((await s.json()).settings);
      if (b.ok) setBlocks((await b.json()).items ?? []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<Settings>) =>
    setSettings((s) => (s ? { ...s, ...p } : s));

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/security/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Configuração de segurança salva.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSavingSettings(false);
    }
  };

  const addBlock = async () => {
    if (!newValue.trim()) {
      toast.error("Informe o valor a bloquear.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admin/security/blocklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          value: newValue.trim(),
          reason: newReason.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewValue("");
      setNewReason("");
      toast.success("Bloqueio adicionado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao bloquear.");
    } finally {
      setAdding(false);
    }
  };

  const lift = async (b: Block) => {
    if (!window.confirm(`Desbloquear ${b.type} ${b.value}?`)) return;
    try {
      const res = await fetch("/api/admin/security/blocklist", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: b.id }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Desbloqueado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao desbloquear.");
    }
  };

  if (forbidden) return null;

  return (
    <div className="space-y-4">
      {/* Configuração */}
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            icon={ShieldAlert}
            title="Defesa — configuração"
            description="Modo de aplicação, limiares de detecção e safe-list (nunca bloqueada)."
          />
          {settings && (
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={settings.kill_switch ? "neutral" : "success"}
                label={settings.kill_switch ? "kill-switch ON" : "ativo"}
              />
              <StatusBadge
                tone={
                  settings.enforcement_mode === "enforce"
                    ? "destructive"
                    : "warning"
                }
                label={
                  settings.enforcement_mode === "enforce"
                    ? "aplicando"
                    : "modo sombra"
                }
              />
            </div>
          )}
        </div>
        {!settings ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : (
          <CardContent className="space-y-4 p-5">
            <Callout
              tone={
                settings.enforcement_mode === "enforce" ? "warning" : "info"
              }
            >
              {settings.enforcement_mode === "enforce"
                ? "APLICANDO: bloqueios de IP têm efeito. O enforcement falha aberto (se o store cair, deixa passar)."
                : "MODO SOMBRA: detecta, audita e notifica, mas NÃO bloqueia automaticamente. Bloqueios manuais de IP têm efeito mesmo em sombra."}
            </Callout>

            <div className="flex flex-wrap gap-2">
              <Button
                variant={
                  settings.enforcement_mode === "shadow" ? "default" : "outline"
                }
                size="sm"
                onClick={() => patch({ enforcement_mode: "shadow" })}
              >
                Modo sombra
              </Button>
              <Button
                variant={
                  settings.enforcement_mode === "enforce"
                    ? "default"
                    : "outline"
                }
                size="sm"
                onClick={() => patch({ enforcement_mode: "enforce" })}
              >
                Aplicando
              </Button>
              <label className="ml-2 flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={settings.auto_block_enabled}
                  onChange={(e) =>
                    patch({ auto_block_enabled: e.target.checked })
                  }
                />
                Auto-bloquear IP
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={settings.auto_suspend_users}
                  onChange={(e) =>
                    patch({ auto_suspend_users: e.target.checked })
                  }
                />
                Auto-suspender usuário
              </label>
              <label className="flex items-center gap-1.5 text-sm text-destructive">
                <input
                  type="checkbox"
                  checked={settings.kill_switch}
                  onChange={(e) => patch({ kill_switch: e.target.checked })}
                />
                Kill-switch (desliga tudo)
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <NumField
                label="Janela (s)"
                value={settings.req_burst_window_s}
                onChange={(v) => patch({ req_burst_window_s: v })}
              />
              <NumField
                label="Máx. req/janela"
                value={settings.req_burst_max}
                onChange={(v) => patch({ req_burst_max: v })}
              />
              <NumField
                label="Máx. 4xx/janela"
                value={settings.deny_burst_max}
                onChange={(v) => patch({ deny_burst_max: v })}
              />
              <NumField
                label="Paths distintos"
                value={settings.path_scan_distinct_max}
                onChange={(v) => patch({ path_scan_distinct_max: v })}
              />
              <NumField
                label="TTL auto-block (s)"
                value={settings.auto_block_ttl_s}
                onChange={(v) => patch({ auto_block_ttl_s: v })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ListField
                label="Safe-list de IPs (um por linha) — NUNCA bloqueados"
                value={settings.safelist_ips}
                onChange={(v) => patch({ safelist_ips: v })}
              />
              <ListField
                label="Safe-list de user IDs (um por linha)"
                value={settings.safelist_user_ids}
                onChange={(v) => patch({ safelist_user_ids: v })}
              />
            </div>

            <Button
              onClick={() => void saveSettings()}
              disabled={savingSettings}
            >
              <Save className="h-4 w-4" />
              Salvar configuração
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Blocklist */}
      <Card className="gap-0 py-0">
        <div className="border-b p-5">
          <SectionHeader
            icon={Ban}
            title="Bloqueios (IP / IoC)"
            count={blocks.length}
            description="IP/CIDR aplicam na borda; user-agent/path ficam p/ o firewall do host (Fase 2)."
          />
        </div>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="w-32">
              <label className="mb-1 block text-xs text-muted-foreground">
                Tipo
              </label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="ip">IP</option>
                <option value="cidr">CIDR</option>
                <option value="user_agent">User-Agent</option>
                <option value="path_pattern">Path</option>
              </select>
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs text-muted-foreground">
                Valor
              </label>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="ex.: 203.0.113.7"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">
                Motivo
              </label>
              <Input
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="opcional"
              />
            </div>
            <Button onClick={() => void addBlock()} disabled={adding}>
              <Plus className="h-4 w-4" />
              Bloquear
            </Button>
          </div>

          {blocks.length === 0 ? (
            <EmptyState icon={Ban} title="Nenhum bloqueio ativo." />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              {blocks.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs uppercase">
                        {b.type}
                      </span>
                      <span className="truncate font-medium">{b.value}</span>
                      <StatusBadge
                        tone={b.source === "auto" ? "warning" : "neutral"}
                        label={b.source}
                        dot={false}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {b.reason ? `${b.reason} · ` : ""}
                      {formatDateTime(b.createdAt)}
                      {b.expiresAt
                        ? ` · expira ${formatDateTime(b.expiresAt)}`
                        : " · permanente"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void lift(b)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Desbloquear
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ListField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">
        {label}
      </label>
      <textarea
        className="min-h-[72px] w-full rounded-md border bg-background p-2 font-mono text-xs"
        value={value.join("\n")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    </div>
  );
}
