"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  ShieldCheck,
  LogOut,
  Loader2,
} from "lucide-react";
import { HackerAISVG } from "@/components/icons/hackerai-svg";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge, EmptyState, type Tone } from "@/app/admin/_ui";

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
  action_plan: "Plano de Ação",
};
const ENG_STATUS: Record<string, string> = {
  planned: "Planejado",
  active: "Ativo",
  review: "Em revisão",
  reporting: "Relatório",
  closed: "Encerrado",
};
const ENG_TONE: Record<string, Tone> = {
  planned: "neutral",
  active: "success",
  review: "warning",
  reporting: "primary",
  closed: "neutral",
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
    <div className="min-h-screen">
      {/* Top bar branded (navy) — casca do portal, sem nav interna */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.06] bg-gradient-to-r from-[#0f1f38] to-[#0b1626] px-4 py-3 text-[#c7d3e6] md:px-8">
        <HackerAISVG theme="dark" scale={0.12} />
        <span className="hidden text-[13px] text-[#7d8ca8] sm:inline">
          Portal do Cliente
        </span>
        <a
          href="/logout"
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-sm font-medium text-[#c7d3e6] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sair
        </a>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 pb-14 pt-6 md:px-8">
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-primary/15 to-[#3f6ef0]/[0.08] text-primary shadow-[inset_0_0_0_1px_rgba(36,86,230,0.14)]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">
              Seus relatórios de segurança
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Baixe os relatórios dos seus engajamentos de teste de intrusão.
            </p>
          </div>
        </div>

        {clients === null ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : clients.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nenhum acesso liberado."
            description="Sua conta ainda não tem acesso a nenhum portal. Fale com seu contato de segurança."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {clients.length > 1 && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Cliente
                </label>
                <select
                  value={clientId ?? ""}
                  onChange={(e) => setClientId(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {engagements.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="Nenhum engajamento disponível."
                description="Assim que um relatório for publicado, ele aparece aqui."
              />
            ) : (
              <div className="flex flex-col gap-3">
                {engagements.map((e) => {
                  const open = openEng === e.id;
                  const reports = reportsByEng[e.id];
                  return (
                    <Card key={e.id} className="gap-0 overflow-hidden py-0">
                      <button
                        onClick={() => void toggleEng(e.id)}
                        className="flex w-full items-center gap-3 p-5 text-left transition-colors hover:bg-muted/30"
                      >
                        {open ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{e.name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {e.code ? `${e.code} · ` : ""}atualizado{" "}
                            {fmtDate(e.updatedAt)}
                          </div>
                        </div>
                        <StatusBadge
                          tone={ENG_TONE[e.status] ?? "neutral"}
                          label={ENG_STATUS[e.status] ?? e.status}
                        />
                      </button>
                      {open && (
                        <div className="border-t p-4">
                          {reports === undefined ? (
                            <p className="py-2 text-center text-sm text-muted-foreground">
                              Carregando…
                            </p>
                          ) : reports.length === 0 ? (
                            <p className="py-2 text-center text-sm text-muted-foreground">
                              Nenhum relatório disponível ainda.
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {reports.map((r) => (
                                <div
                                  key={r.id}
                                  className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-[var(--shadow-soft)]"
                                >
                                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">
                                      {AUDIENCE[r.audience] ?? r.audience} · v
                                      {r.version}
                                    </div>
                                    <div className="text-xs uppercase text-muted-foreground">
                                      {r.format} · {fmtDate(r.createdAt)}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => void download(r)}
                                    disabled={downloading === r.id}
                                  >
                                    {downloading === r.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Download className="h-4 w-4" />
                                    )}
                                    {downloading === r.id
                                      ? "Baixando…"
                                      : "Baixar"}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
