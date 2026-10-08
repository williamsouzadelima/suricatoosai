"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Server,
  Circle,
  Trash2,
  RotateCcw,
  RefreshCw,
  Loader2,
  Info,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AppShell } from "@/components/internal/app-shell";
import {
  SectionHeader,
  EmptyState,
  Callout,
  formatDateTime,
} from "@/app/admin/_ui";
import { SecurityTab } from "@/app/components/SecurityTab";

/**
 * Segurança da CONTA (não é a segurança de infra/WAF do /admin). Mostra só o
 * que tem backend real: autenticação via widget WorkOS (MFA/senha/sessões),
 * dispositivos/agentes conectados (localSandbox) e o token do agente. SSO/SAML,
 * score de postura e logout automático não existem no backend → ficam de fora
 * com uma nota honesta, em vez de dado fabricado.
 */
export function SegurancaPanel({
  userEmail,
  userRole,
}: {
  userEmail?: string;
  userRole?: string;
}) {
  return (
    <AppShell
      active="seguranca"
      title="Segurança"
      description="Autenticação, sessões, dispositivos conectados e o token do agente da sua conta."
      icon={ShieldCheck}
      breadcrumb={["Segurança"]}
      userEmail={userEmail}
      userRole={userRole}
    >
      <div className="flex flex-col gap-5">
        <Card className="gap-0 py-0">
          <div className="border-b p-5">
            <SectionHeader
              icon={ShieldCheck}
              title="Autenticação"
              description="MFA, senha e sessões da sua conta (WorkOS)."
            />
          </div>
          <div className="p-5">
            <SecurityTab />
          </div>
        </Card>

        <ConnectedDevices />

        <Callout tone="neutral" icon={Info}>
          Ainda sem backend (roadmap): SSO/SAML (Microsoft Entra ID), score de
          postura, logout automático por inatividade e chaves de API com escopo.
          A segurança de infraestrutura (bloqueio de IP, detecção de ameaça e
          trilha de auditoria) fica no Painel admin.
        </Callout>
      </div>
    </AppShell>
  );
}

function ConnectedDevices() {
  const connections = useQuery(api.localSandbox.listConnections);
  const revoked = useQuery(api.localSandbox.listRevokedConnectors);
  const revoke = useMutation(api.localSandbox.revokeConnection);
  const unrevoke = useMutation(api.localSandbox.unrevokeConnection);
  const regenerateToken = useMutation(api.localSandbox.regenerateToken);
  const [busy, setBusy] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Ação falhou.";
      toast.error(msg);
      console.error(e);
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerate = async () => {
    if (
      !window.confirm(
        "Regenerar o token do agente desconecta todos os conectores/desktop ativos e exige reconfigurar o comando de conexão. Continuar?",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      await regenerateToken();
      toast.success(
        "Token regenerado. Reconecte os agentes com o novo comando (Configurações → Controle remoto).",
      );
    } catch (e) {
      toast.error("Falha ao regenerar o token.");
      console.error(e);
    } finally {
      setResetting(false);
    }
  };

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-2 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader
          icon={Server}
          title="Dispositivos & agentes conectados"
          description="App desktop e conectores Remote Control (token único por conta)."
          count={connections?.length}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRegenerate()}
          disabled={resetting}
          className="shrink-0 text-muted-foreground hover:text-destructive"
          title="Revoga o token: desconecta todos os agentes"
        >
          {resetting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Regenerar token
        </Button>
      </div>

      {connections === undefined ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Server}
          title="Nenhum dispositivo conectado."
          description="Conecte o app desktop ou um agente Remote Control em Configurações → Controle remoto."
        />
      ) : (
        <div className="divide-y">
          {connections.map((conn) => (
            <div
              key={conn.connectionId}
              className="flex items-center gap-3 p-4"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <Circle className="h-2.5 w-2.5 fill-success text-success" />
                <Circle className="absolute inset-0 h-2.5 w-2.5 animate-ping fill-success text-success opacity-75" />
              </span>
              <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {conn.osInfo?.hostname || conn.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {conn.isDesktop ? "App desktop" : "Conector Remote Control"}
                  {conn.osInfo
                    ? ` · ${conn.osInfo.platform} ${conn.osInfo.arch}`
                    : ""}
                  {` · visto ${formatDateTime(conn.lastSeen)}`}
                </div>
              </div>
              <span className="shrink-0 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {conn.isDesktop
                  ? conn.appVersion
                    ? `v${conn.appVersion}`
                    : "desktop"
                  : `v${conn.clientVersion}`}
              </span>
              {!conn.isDesktop && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    void run(
                      conn.connectionId,
                      () => revoke({ connectionId: conn.connectionId }),
                      "Conector revogado.",
                    )
                  }
                  disabled={busy === conn.connectionId}
                  title="Revogar este conector"
                >
                  {busy === conn.connectionId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {revoked && revoked.length > 0 && (
        <div className="border-t p-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Conectores revogados
          </div>
          <div className="space-y-2">
            {revoked.map((r) => (
              <div
                key={r.connectionName}
                className="flex items-center gap-3 rounded-lg bg-muted/30 p-3"
              >
                <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {r.connectionName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Bloqueado · revogado {formatDateTime(r.revokedAt)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  onClick={() =>
                    void run(
                      `unrevoke:${r.connectionName}`,
                      () => unrevoke({ connectionName: r.connectionName }),
                      "Conector liberado.",
                    )
                  }
                  disabled={busy === `unrevoke:${r.connectionName}`}
                >
                  {busy === `unrevoke:${r.connectionName}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Permitir de novo
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
