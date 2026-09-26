"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader, StatusBadge, formatDateTime } from "@/app/admin/_ui";

interface Member {
  userId: string;
  email: string;
  status: string;
  grantedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export function PortalAccessCard({
  clientId,
  clientName,
  portalEnabled,
}: {
  clientId: string;
  clientName: string;
  portalEnabled: boolean;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [togglingPortal, setTogglingPortal] = useState(false);

  const togglePortal = async () => {
    const next = !portalEnabled;
    if (
      !next &&
      !window.confirm(
        `Desabilitar o portal de ${clientName}? TODOS os contatos deste cliente perdem o acesso imediatamente (kill-switch).`,
      )
    ) {
      return;
    }
    setTogglingPortal(true);
    try {
      const res = await fetch("/api/admin/portal-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, enabled: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(next ? "Portal habilitado." : "Portal desabilitado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao alterar o portal.",
      );
    } finally {
      setTogglingPortal(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/portal-access?clientId=${encodeURIComponent(clientId)}`,
        { cache: "no-store" },
      );
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setMembers(d.members ?? []);
    } catch (e) {
      console.error(e);
      setMembers([]);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = async () => {
    if (!email.trim().includes("@")) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, email: email.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      if (d.status === "invited") {
        toast.success(d.message ?? "Convite enviado.");
      } else {
        toast.success(`Acesso concedido a ${d.email}.`);
      }
      setEmail("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao conceder.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (m: Member) => {
    if (!window.confirm(`Revogar o acesso de ${m.email}?`)) return;
    try {
      const res = await fetch("/api/admin/portal-access", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, userId: m.userId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Acesso revogado.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao revogar.");
    }
  };

  if (forbidden) return null;

  return (
    <Card className="gap-0 py-0">
      <div className="border-b p-5">
        <SectionHeader
          icon={ShieldCheck}
          title="Acesso ao portal"
          description={`Quem do cliente (${clientName}) pode ver e baixar os relatórios pelo portal.`}
          action={
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={portalEnabled ? "success" : "neutral"}
                label={portalEnabled ? "portal ligado" : "portal desligado"}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void togglePortal()}
                disabled={togglingPortal}
              >
                {portalEnabled ? "Desabilitar" : "Habilitar"}
              </Button>
            </div>
          }
        />
      </div>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">
              E-mail do contato do cliente
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@cliente.com"
            />
          </div>
          <Button onClick={() => void grant()} disabled={busy}>
            <UserPlus className="h-4 w-4" />
            Conceder
          </Button>
        </div>

        {members === null ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ninguém tem acesso ao portal deste cliente ainda.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{m.email}</div>
                  <div className="text-xs text-muted-foreground">
                    concedido {formatDateTime(m.createdAt)}
                    {m.grantedBy ? ` por ${m.grantedBy}` : ""}
                  </div>
                </div>
                <StatusBadge
                  tone={m.status === "active" ? "success" : "neutral"}
                  label={m.status === "active" ? "ativo" : "revogado"}
                />
                {m.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void revoke(m)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
