"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound,
  Plus,
  Trash2,
  RotateCcw,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  SectionHeader,
  StatusBadge,
  Callout,
  EmptyState,
  PanelSkeleton,
  formatDateTime,
  useConfirm,
} from "./_ui";

type KeyStatus = "untested" | "active" | "exhausted" | "error";

type KeyRow = {
  id: string;
  label: string;
  provider: string;
  last4: string;
  enabled: boolean;
  priority: number;
  status: KeyStatus;
  exhaustedAt: number | null;
  lastUsedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

const STATUS_META: Record<
  KeyStatus,
  { label: string; tone: "success" | "neutral" | "warning" | "destructive" }
> = {
  active: { label: "ativa", tone: "success" },
  untested: { label: "não testada", tone: "neutral" },
  exhausted: { label: "sem crédito", tone: "warning" },
  error: { label: "erro", tone: "destructive" },
};

export function LlmKeysPanel() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [encConfigured, setEncConfigured] = useState(true);
  const [envKeyPresent, setEnvKeyPresent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [priority, setPriority] = useState("100");
  const [confirm, confirmUI] = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/llm-keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKeys((data.keys ?? []) as KeyRow[]);
      setEncConfigured(!!data.encConfigured);
      setEnvKeyPresent(!!data.envKeyPresent);
    } catch {
      toast.error("Falha ao carregar as chaves");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>, okMsg: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/admin/llm-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok || data?.error) {
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        toast.success(okMsg);
        await load();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const add = async () => {
    if (!secret.trim() || !label.trim()) {
      toast.error("Rótulo e chave são obrigatórios");
      return;
    }
    const ok = await post(
      {
        action: "add",
        label: label.trim(),
        key: secret.trim(),
        priority: Number(priority) || 100,
      },
      "Chave adicionada",
    );
    if (ok) {
      setLabel("");
      setSecret("");
      setPriority("100");
    }
  };

  const remove = async (k: KeyRow) => {
    const ok = await confirm({
      title: `Remover "${k.label}"?`,
      description: `A chave ••••${k.last4} será apagada do pool. Não pode ser desfeito.`,
      confirmLabel: "Remover",
      tone: "destructive",
    });
    if (ok) await post({ action: "delete", id: k.id }, "Chave removida");
  };

  const usable = keys.filter(
    (k) => k.enabled && (k.status === "active" || k.status === "untested"),
  ).length;

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={KeyRound}
        title="Pool de chaves de LLM"
        description="Várias chaves OpenRouter com failover automático quando uma fica sem crédito."
        count={keys.length}
      />

      {!encConfigured && (
        <Callout tone="destructive" icon={AlertTriangle}>
          <strong>LLM_KEY_ENC_SECRET não configurado no servidor.</strong> Defina
          esse segredo-mestre no ambiente de produção para adicionar chaves com
          segurança — elas são cifradas em repouso (AES-256-GCM).
        </Callout>
      )}
      {envKeyPresent && (
        <Callout tone="neutral" icon={ShieldCheck}>
          A chave do ambiente (<code>OPENROUTER_API_KEY</code>) segue como{" "}
          <strong>bootstrap/fallback</strong>: se o pool estiver vazio ou todas
          sem crédito, ela é usada — então nada quebra enquanto você configura o
          pool.
        </Callout>
      )}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr_7rem_auto]">
            <Input
              placeholder="Rótulo (ex.: OpenRouter #2)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={!encConfigured || busy}
            />
            <Input
              type="password"
              placeholder="Chave de API (sk-or-...)"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={!encConfigured || busy}
              autoComplete="off"
            />
            <Input
              type="number"
              placeholder="Prioridade"
              title="Menor = tentada primeiro"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={!encConfigured || busy}
            />
            <Button onClick={() => void add()} disabled={!encConfigured || busy}>
              <Plus className="mr-1 h-4 w-4" />
              Adicionar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A chave é cifrada antes de sair do servidor; aqui só ficam os últimos
            4 dígitos. Menor prioridade = tentada primeiro no failover.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <PanelSkeleton rows={3} />
      ) : keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Nenhuma chave no pool"
          description="Adicione uma chave OpenRouter acima para habilitar o failover por crédito."
        />
      ) : (
        <Card>
          <CardContent className="pt-4">
            <div className="mb-3 text-xs text-muted-foreground">
              <strong className="text-foreground">{usable}</strong> de{" "}
              {keys.length} utilizáveis agora
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Rótulo</th>
                    <th className="pb-2 pr-3 font-medium">Chave</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Prior.</th>
                    <th className="pb-2 pr-3 font-medium">Último uso</th>
                    <th className="pb-2 pr-3 font-medium">Ligada</th>
                    <th className="pb-2 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const meta = STATUS_META[k.status];
                    return (
                      <tr
                        key={k.id}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="py-2 pr-3 font-medium text-foreground">
                          {k.label}
                        </td>
                        <td className="py-2 pr-3 font-mono text-muted-foreground">
                          ••••{k.last4}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge tone={meta.tone} label={meta.label} />
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {k.priority}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Switch
                            checked={k.enabled}
                            disabled={busy}
                            onCheckedChange={(v) =>
                              void post(
                                { action: "update", id: k.id, enabled: v },
                                v ? "Chave ligada" : "Chave desligada",
                              )
                            }
                          />
                        </td>
                        <td className="py-2 text-right">
                          <div className="inline-flex gap-1">
                            {(k.status === "exhausted" ||
                              k.status === "error") && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                title="Reativar (crédito recarregado)"
                                onClick={() =>
                                  void post(
                                    {
                                      action: "set-status",
                                      id: k.id,
                                      status: "untested",
                                    },
                                    "Chave reativada",
                                  )
                                }
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              title="Remover"
                              onClick={() => void remove(k)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {confirmUI}
    </div>
  );
}
