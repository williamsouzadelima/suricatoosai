"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, Send, TestTube2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Segment = "active" | "invited" | "all";

interface Campaign {
  subject: string;
  segment: string;
  total: number;
  sent: number;
  failed: number;
  created_by?: string;
  created_at: number;
}

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "active", label: "Ativos" },
  { value: "invited", label: "Convidados" },
  { value: "all", label: "Todos" },
];

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export function MarketingTab() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [segment, setSegment] = useState<Segment>("active");
  const [counts, setCounts] = useState<Record<Segment, number>>({
    active: 0,
    invited: 0,
    all: 0,
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/marketing", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCounts(data.counts ?? { active: 0, invited: 0, all: 0 });
      setCampaigns(data.campaigns ?? []);
      setEmailConfigured(Boolean(data.emailConfigured));
      setAdminEmail(data.adminEmail ?? null);
    } catch (error) {
      toast.error("Falha ao carregar marketing.");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recipientCount = counts[segment] ?? 0;

  const valid = useMemo(
    () => subject.trim().length > 0 && body.trim().length > 0,
    [subject, body],
  );

  const sendTest = useCallback(async () => {
    if (!valid) {
      toast.error("Preencha assunto e mensagem.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/admin/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(`Teste enviado para ${data.to}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no teste.");
    } finally {
      setTesting(false);
    }
  }, [valid, subject, body]);

  const sendCampaign = useCallback(async () => {
    if (!valid) {
      toast.error("Preencha assunto e mensagem.");
      return;
    }
    if (
      !window.confirm(
        `Enviar "${subject.trim()}" para ${recipientCount} ${
          recipientCount === 1 ? "pessoa" : "pessoas"
        } (${SEGMENTS.find((s) => s.value === segment)?.label})? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/admin/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", segment, subject, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.failed > 0) {
        toast.warning(
          `Enviados ${data.sent}/${data.total}. ${data.failed} falharam${
            data.error ? ` (${data.error})` : ""
          }.`,
        );
      } else {
        toast.success(`Campanha enviada para ${data.sent} pessoas.`);
      }
      setSubject("");
      setBody("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no envio.");
    } finally {
      setSending(false);
    }
  }, [valid, subject, body, segment, recipientCount, load]);

  return (
    <div className="mt-6 space-y-4">
      {!emailConfigured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          RESEND_API_KEY não está configurada no servidor — envios ficam
          bloqueados até ela existir.
        </div>
      )}

      {/* Compose */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Nova campanha</h2>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Segmento
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {SEGMENTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSegment(s.value)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    segment === s.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  {s.label}
                  <span className="tabular-nums opacity-70">
                    {counts[s.value] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Input
            placeholder="Assunto"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <textarea
            placeholder="Mensagem (linhas em branco separam parágrafos)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Todo e-mail inclui rodapé de descadastro automático. Descadastrados
            são excluídos do envio.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => void sendCampaign()}
              disabled={sending || !valid || recipientCount === 0}
            >
              <Send className="h-4 w-4" />
              {sending
                ? "Enviando…"
                : `Enviar para ${recipientCount} ${recipientCount === 1 ? "pessoa" : "pessoas"}`}
            </Button>
            <Button
              variant="outline"
              onClick={() => void sendTest()}
              disabled={testing || !valid}
            >
              <TestTube2 className="h-4 w-4" />
              {testing
                ? "Enviando…"
                : `Teste${adminEmail ? ` (p/ ${adminEmail})` : ""}`}
            </Button>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="text-base font-semibold">Histórico</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Nenhuma campanha enviada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Assunto</th>
                  <th className="px-5 py-3 font-medium">Segmento</th>
                  <th className="px-5 py-3 text-right font-medium">Enviados</th>
                  <th className="px-5 py-3 text-right font-medium">Falhas</th>
                  <th className="px-5 py-3 font-medium">Quando</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-5 py-3 font-medium">{c.subject}</td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {SEGMENTS.find((s) => s.value === c.segment)?.label ??
                        c.segment}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {c.sent}/{c.total}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {c.failed > 0 ? (
                        <span className="text-destructive">{c.failed}</span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {fmt(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
