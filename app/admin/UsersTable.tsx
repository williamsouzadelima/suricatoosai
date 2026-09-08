"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Ban, RotateCcw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toCsv, downloadCsv, csvName } from "@/lib/utils/csv";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  allowlistStatus: "invited" | "active" | "revoked" | null;
  suspended: boolean;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costDollars: number;
  lastActivityAt: number | null;
  capped: boolean;
}

const fmtDate = (v: string | number | null) =>
  v
    ? new Date(v).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const fmtNum = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}k`
      : String(n);

export function UsersTable() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (error) {
      toast.error("Falha ao carregar usuários.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSuspend = useCallback(
    async (u: UserRow) => {
      const action = u.suspended ? "unsuspend" : "suspend";
      if (
        action === "suspend" &&
        !window.confirm(
          `Suspender ${u.email}? O acesso ao chat é bloqueado imediatamente até reativar.`,
        )
      ) {
        return;
      }
      setBusyId(u.id);
      try {
        const res = await fetch("/api/admin/users/suspend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: u.id, action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        toast.success(
          action === "suspend"
            ? `Suspenso: ${u.email}`
            : `Reativado: ${u.email}`,
        );
        await load();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Falha na operação.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name ?? "").toLowerCase().includes(q),
    );
  }, [users, query]);

  const exportCsv = useCallback(() => {
    const rows = filtered.map((u) => ({
      email: u.email,
      nome: u.name ?? "",
      status: u.allowlistStatus ?? "",
      suspenso: u.suspended ? "sim" : "nao",
      requests: u.requests,
      tokens_entrada: u.inputTokens,
      tokens_saida: u.outputTokens,
      custo_usd: u.costDollars.toFixed(2),
      ultima_atividade: u.lastActivityAt
        ? new Date(u.lastActivityAt).toISOString()
        : "",
      entrou: u.lastSignInAt ?? "",
    }));
    downloadCsv(
      csvName("usuarios"),
      toCsv(rows, [
        { key: "email", label: "E-mail" },
        { key: "nome", label: "Nome" },
        { key: "status", label: "Status" },
        { key: "suspenso", label: "Suspenso" },
        { key: "requests", label: "Requests" },
        { key: "tokens_entrada", label: "Tokens entrada" },
        { key: "tokens_saida", label: "Tokens saida" },
        { key: "custo_usd", label: "Custo USD" },
        { key: "ultima_atividade", label: "Ultima atividade" },
        { key: "entrou", label: "Entrou" },
      ]),
    );
  }, [filtered]);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold">
          Usuários
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {users.length}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative sm:w-72">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar e-mail ou nome…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title="Exportar CSV"
          >
            <Download className="h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center text-sm text-muted-foreground">
          Nenhum usuário.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Usuário</th>
                <th className="px-5 py-3 font-medium">Últ. atividade</th>
                <th className="px-5 py-3 text-right font-medium">Reqs</th>
                <th className="px-5 py-3 text-right font-medium">Tokens</th>
                <th className="px-5 py-3 text-right font-medium">Custo</th>
                <th className="px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr
                  key={u.id}
                  className="border-b transition-colors last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      {u.email}
                      {u.suspended && (
                        <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          suspenso
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {u.name ? `${u.name} · ` : ""}
                      {u.allowlistStatus ?? "fora da lista"} · entrou{" "}
                      {fmtDate(u.lastSignInAt)}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {fmtDate(u.lastActivityAt)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {fmtNum(u.requests)}
                    {u.capped ? "+" : ""}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {fmtNum(u.inputTokens + u.outputTokens)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    ${u.costDollars.toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {u.suspended ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === u.id}
                        onClick={() => void toggleSuspend(u)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reativar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busyId === u.id}
                        onClick={() => void toggleSuspend(u)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Suspender
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
