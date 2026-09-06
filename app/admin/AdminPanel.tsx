"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

const statusVariant: Record<
  Status,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  invited: "secondary",
  revoked: "destructive",
};

const fmtDate = (ms?: number) =>
  ms ? new Date(ms).toLocaleString("pt-BR") : "—";

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
  const [inviting, setInviting] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
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
          : `${target} adicionado à lista (e-mail de convite não enviado).`,
      );
      setEmail("");
      setNote("");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao convidar.",
      );
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

  const counts = entries.reduce(
    (acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<Status, number>,
  );

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Controle de acesso</h1>
          <p className="text-sm text-muted-foreground">
            Superadmin: {adminEmail}
          </p>
          {!inviteOnlyEnabled && (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              Acesso por convite está <strong>desligado</strong>
              {" "}(INVITE_ONLY_ENABLED ≠ true). Convites são registrados, mas
              qualquer pessoa ainda consegue entrar até você ligar a flag.
            </p>
          )}
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Convidar</CardTitle>
            <CardDescription>
              Adiciona o e-mail à lista e envia um convite (link de cadastro) por
              e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
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
                className="sm:w-48"
              />
              <Button onClick={() => void invite()} disabled={inviting}>
                {inviting ? "Enviando…" : "Convidar"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Lista de acesso
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {entries.length} · {counts.active ?? 0} ativos ·{" "}
                {counts.invited ?? 0} convidados · {counts.revoked ?? 0}{" "}
                revogados
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ninguém na lista ainda.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">E-mail</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="py-2 pr-4 font-medium">Convidado</th>
                      <th className="py-2 pr-4 font-medium">Ativo desde</th>
                      <th className="py-2 pr-4 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.email} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{e.email}</div>
                          {e.note && (
                            <div className="text-xs text-muted-foreground">
                              {e.note}
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={statusVariant[e.status]}>
                            {e.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {fmtDate(e.invited_at)}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {fmtDate(e.activated_at)}
                        </td>
                        <td className="py-2 pr-4">
                          {e.status === "revoked" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyEmail === e.email}
                              onClick={() => void act(e.email, "reinvite")}
                            >
                              Reconvidar
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyEmail === e.email}
                              onClick={() => void act(e.email, "revoke")}
                            >
                              Revogar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
