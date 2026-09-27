"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface ClientOpt {
  id: string;
  name: string;
}
interface Engagement {
  id: string;
  name: string;
  code: string | null;
  status: string;
  updatedAt: number;
}
interface Report {
  id: string;
  audience: string;
  format: string;
  version: number;
  title: string;
  reportGroupId: string;
  createdAt: number;
}

const AUDIENCE: Record<string, string> = {
  technical: "Técnico",
  executive: "Executivo",
  commercial: "Comercial",
};
const ENG_STATUS: Record<string, string> = {
  planned: "Planejado",
  active: "Ativo",
  review: "Em revisão",
  reporting: "Relatório",
  closed: "Encerrado",
};

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function PortalPage() {
  const [clients, setClients] = useState<ClientOpt[] | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [openEng, setOpenEng] = useState<string | null>(null);
  const [reportsByEng, setReportsByEng] = useState<Record<string, Report[]>>(
    {},
  );
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/portal/clients", { cache: "no-store" });
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const d = await res.json();
        const list: ClientOpt[] = d.clients ?? [];
        setClients(list);
        if (list.length > 0) setClientId(list[0].id);
      } catch {
        setClients([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (!clientId) return;
    setEngagements([]);
    setOpenEng(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/portal/engagements?clientId=${encodeURIComponent(clientId)}`,
          { cache: "no-store" },
        );
        const d = await res.json();
        setEngagements(d.engagements ?? []);
      } catch {
        setEngagements([]);
      }
    })();
  }, [clientId]);

  const toggleEng = useCallback(
    async (id: string) => {
      if (openEng === id) {
        setOpenEng(null);
        return;
      }
      setOpenEng(id);
      if (!reportsByEng[id]) {
        try {
          const res = await fetch(
            `/api/portal/reports?engagementId=${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          const d = await res.json();
          setReportsByEng((m) => ({ ...m, [id]: d.reports ?? [] }));
        } catch {
          setReportsByEng((m) => ({ ...m, [id]: [] }));
        }
      }
    },
    [openEng, reportsByEng],
  );

  const download = useCallback(async (r: Report) => {
    setDownloading(r.id);
    try {
      const res = await fetch(`/api/portal/reports/${r.id}/download`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        toast.error("Sessão expirada — faça login novamente para baixar.");
        window.location.href = "/login";
        return;
      }
      if (!res.ok) {
        toast.error("Não foi possível baixar o relatório.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${AUDIENCE[r.audience] ?? r.audience}_v${r.version}.${r.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Falha no download.");
    } finally {
      setDownloading(null);
    }
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-[system-ui] text-xl font-bold">
            Portal do Cliente
          </h1>
          <p className="text-sm text-[#64748b]">
            Acesso seguro aos seus relatórios de segurança.
          </p>
        </div>
        <a
          href="/logout"
          className="rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5 text-sm hover:bg-[#f1f5f9]"
        >
          Sair
        </a>
      </header>

      {clients === null ? (
        <div className="py-16 text-center text-sm text-[#64748b]">
          Carregando…
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-10 text-center">
          <p className="font-medium">Nenhum acesso liberado.</p>
          <p className="mt-1 text-sm text-[#64748b]">
            Sua conta ainda não tem acesso a nenhum portal. Fale com seu contato
            de segurança.
          </p>
        </div>
      ) : (
        <>
          {clients.length > 1 && (
            <div className="mb-4">
              <label className="mb-1 block text-xs text-[#64748b]">
                Cliente
              </label>
              <select
                value={clientId ?? ""}
                onChange={(e) => setClientId(e.target.value)}
                className="h-9 rounded-md border border-[#e2e8f0] bg-white px-2 text-sm"
              >
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-3">
            {engagements.length === 0 ? (
              <div className="rounded-xl border border-[#e2e8f0] bg-white p-8 text-center text-sm text-[#64748b]">
                Nenhum engajamento disponível.
              </div>
            ) : (
              engagements.map((e) => {
                const open = openEng === e.id;
                const reports = reportsByEng[e.id];
                return (
                  <div
                    key={e.id}
                    className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white"
                  >
                    <button
                      onClick={() => void toggleEng(e.id)}
                      className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#f8fafc]"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.name}</div>
                        <div className="text-xs text-[#64748b]">
                          {e.code ? `${e.code} · ` : ""}
                          {ENG_STATUS[e.status] ?? e.status} · atualizado{" "}
                          {fmtDate(e.updatedAt)}
                        </div>
                      </div>
                      <span className="text-[#64748b]">{open ? "▲" : "▼"}</span>
                    </button>
                    {open && (
                      <div className="border-t border-[#e2e8f0] p-4">
                        {reports === undefined ? (
                          <p className="text-sm text-[#64748b]">Carregando…</p>
                        ) : reports.length === 0 ? (
                          <p className="text-sm text-[#64748b]">
                            Nenhum relatório disponível ainda.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {reports.map((r) => (
                              <div
                                key={r.id}
                                className="flex items-center justify-between gap-3 rounded-lg border border-[#e2e8f0] px-4 py-2.5"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">
                                    {AUDIENCE[r.audience] ?? r.audience} · v
                                    {r.version}
                                  </div>
                                  <div className="text-xs uppercase text-[#64748b]">
                                    {r.format} · {fmtDate(r.createdAt)}
                                  </div>
                                </div>
                                <button
                                  onClick={() => void download(r)}
                                  disabled={downloading === r.id}
                                  className="shrink-0 rounded-md bg-[#2456e6] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1d47c4] disabled:opacity-60"
                                >
                                  {downloading === r.id
                                    ? "Baixando…"
                                    : "Baixar"}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
