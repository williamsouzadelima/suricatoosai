"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { X, Ban, RotateCcw, ShieldOff, MailPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UserRow } from "./UsersTable";

interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  created_at: number;
}

const fmtDate = (v: string | number | null | undefined) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

export function UserDetailModal({
  user,
  onClose,
  onChanged,
}: {
  user: UserRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/audit", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (cancelled) return;
        const rel = ((d.items ?? []) as AuditEntry[]).filter(
          (e) => e.target === user.email || e.target === user.id,
        );
        setAudit(rel.slice(0, 25));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user.email, user.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleSuspend = useCallback(async () => {
    const action = user.suspended ? "unsuspend" : "suspend";
    if (
      action === "suspend" &&
      !window.confirm(`Suspender ${user.email}? O chat é bloqueado na hora.`)
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users/suspend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(action === "suspend" ? "Suspenso." : "Reativado.");
      onChanged();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha.");
    } finally {
      setBusy(false);
    }
  }, [user, onChanged, onClose]);

  const toggleAccess = useCallback(async () => {
    const action = user.allowlistStatus === "revoked" ? "reinvite" : "revoke";
    if (
      action === "revoke" &&
      !window.confirm(
        `Revogar o acesso de ${user.email}? Ele não conseguirá mais entrar.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(action === "revoke" ? "Acesso revogado." : "Reconvidado.");
      onChanged();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha.");
    } finally {
      setBusy(false);
    }
  }, [user, onChanged, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="mx-auto mt-10 w-full max-w-lg rounded-xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold">{user.email}</h2>
              {user.suspended && (
                <span className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  suspenso
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {user.name || "—"} · {user.allowlistStatus ?? "fora da lista"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-2 gap-4 p-5">
          <Field label="Requests" value={user.requests + (user.capped ? "+" : "")} />
          <Field
            label="Tokens"
            value={(user.inputTokens + user.outputTokens).toLocaleString("pt-BR")}
          />
          <Field label="Custo" value={`$${user.costDollars.toFixed(2)}`} />
          <Field label="Últ. atividade" value={fmtDate(user.lastActivityAt)} />
          <Field label="Entrou" value={fmtDate(user.lastSignInAt)} />
          <Field label="Criado" value={fmtDate(user.createdAt)} />
          <Field
            label="WorkOS ID"
            value={<span className="break-all font-mono text-xs">{user.id}</span>}
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 border-t p-5">
          {user.suspended ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void toggleSuspend()}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reativar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => void toggleSuspend()}
            >
              <Ban className="h-3.5 w-3.5" />
              Suspender
            </Button>
          )}
          {user.allowlistStatus === "revoked" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void toggleAccess()}
            >
              <MailPlus className="h-3.5 w-3.5" />
              Reconvidar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy}
              onClick={() => void toggleAccess()}
            >
              <ShieldOff className="h-3.5 w-3.5" />
              Revogar acesso
            </Button>
          )}
        </div>

        {/* Audit */}
        <div className="border-t p-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Histórico deste usuário
          </h3>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma ação registrada.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {audit.map((e, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">
                  <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {e.action}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {e.detail || ""}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtDate(e.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
