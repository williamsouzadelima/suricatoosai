"use client";

// Peças compartilhadas de ACHADOS dos painéis internos (/engagements, /achados).
// Fonte única do visual + da curadoria de findings — qualquer rota que mostre
// achado/evidência monta a partir daqui em vez de refazer markup/ações.
// Regra do design system (ver app/admin/_ui): ZERO hex hardcoded fora dos
// terminais de evidência (que são intencionalmente navy #0e1b2e).

import { useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ListOrdered,
  Paperclip,
  Image as ImageIcon,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Callout, type Tone } from "@/app/admin/_ui";

// ── Tipos + constantes de apresentação ─────────────────────────────────────

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type FindingStatus =
  "draft" | "in_review" | "approved" | "published" | "dismissed";

export const SEVERITY_TONE: Record<Severity, Tone> = {
  critical: "destructive",
  high: "destructive",
  medium: "warning",
  low: "primary",
  info: "neutral",
};
export const STATUS_TONE: Record<FindingStatus, Tone> = {
  draft: "neutral",
  in_review: "warning",
  approved: "success",
  published: "brand",
  dismissed: "destructive",
};
export const STATUS_LABEL: Record<FindingStatus, string> = {
  draft: "Rascunho",
  in_review: "Em revisão",
  approved: "Aprovado",
  published: "Publicado",
  dismissed: "Descartado",
};
export const RETEST_BADGE: Record<string, { tone: Tone; label: string }> = {
  fixed: { tone: "success", label: "Corrigido" },
  still_vulnerable: { tone: "destructive", label: "Ainda vulnerável" },
  pending: { tone: "warning", label: "Retest pendente" },
};
export const SEV_LABEL: Record<Severity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
  info: "Info",
};
export const SEV_STRIPE: Record<Severity, string> = {
  critical: "bg-destructive",
  high: "bg-[#e8590c]",
  medium: "bg-warning",
  low: "bg-primary",
  info: "bg-muted-foreground",
};
export const SEV_PILL: Record<Severity, string> = {
  critical: "text-destructive bg-destructive/10 border-destructive/25",
  high: "text-[#e8590c] bg-[#e8590c]/10 border-[#e8590c]/25",
  medium: "text-warning bg-warning/10 border-warning/25",
  low: "text-primary bg-primary/10 border-primary/25",
  info: "text-muted-foreground bg-muted border-border",
};

// ── Ações de curadoria (identity-only; o agente não tem estas mutations) ────

/**
 * Botões de transição de estado de UM achado (submit → review → approve →
 * publish, + dismiss/reopen/retest). Fonte única da curadoria por-achado,
 * usada no board de /engagements e no detalhe de /achados. As regras de
 * posse/estado vivem no Convex (convex/findings.ts).
 */
export function FindingActions({
  findingId,
  status,
}: {
  findingId: Id<"findings">;
  status: FindingStatus;
}) {
  const submit = useMutation(api.findings.submitForReview);
  const approve = useMutation(api.findings.approveFinding);
  const publish = useMutation(api.findings.publishFinding);
  const dismiss = useMutation(api.findings.dismissFinding);
  const reopen = useMutation(api.findings.reopenFinding);
  const retest = useMutation(api.findings.retestFinding);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "Ação falhou.";
      toast.error(msg);
      console.error(e);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "draft" && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void run(() => submit({ findingId }), "Enviado para revisão.")
          }
        >
          Enviar p/ revisão
        </Button>
      )}
      {status === "in_review" && (
        <>
          <Button
            size="sm"
            onClick={() => void run(() => approve({ findingId }), "Aprovado.")}
          >
            Aprovar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void run(() => dismiss({ findingId }), "Descartado.")
            }
          >
            Descartar
          </Button>
        </>
      )}
      {status === "approved" && (
        <Button
          size="sm"
          onClick={() => void run(() => publish({ findingId }), "Publicado.")}
        >
          Publicar
        </Button>
      )}
      {(status === "approved" ||
        status === "published" ||
        status === "dismissed") && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void run(() => reopen({ findingId }), "Reaberto em revisão.")
          }
        >
          Reabrir
        </Button>
      )}
      {(status === "approved" || status === "published") && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="text-success hover:text-success"
            title="Revalidado: o cliente corrigiu"
            onClick={() =>
              void run(
                () => retest({ findingId, outcome: "fixed" }),
                "Marcado como corrigido.",
              )
            }
          >
            Corrigido
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            title="Revalidado: ainda vulnerável"
            onClick={() =>
              void run(
                () => retest({ findingId, outcome: "still_vulnerable" }),
                "Marcado como ainda vulnerável.",
              )
            }
          >
            Persiste
          </Button>
        </>
      )}
    </div>
  );
}

// ── Detalhe de evidência (narrativa + galeria + cadeia em timeline) ─────────

/**
 * Corpo do achado: metadados (classe/CVSS/CWE), blocos narrativos, galeria de
 * screenshots e a CADEIA DE EVIDÊNCIA como timeline (passo → ferramenta →
 * comando → prova). Lê a evidência reativamente e ordena pela cadeia.
 */
export function FindingEvidence({
  findingId,
  finding,
}: {
  findingId: Id<"findings">;
  finding: {
    description?: string;
    impact?: string;
    remediation?: string;
    narrative?: string;
    weakness_class: string;
    cvss_vector?: string;
    cwe?: string;
  };
}) {
  const evidenceRaw = useQuery(api.findings.listEvidenceForFinding, {
    findingId,
  });
  // Ordena pela cadeia (step_index; sem índice → pelo tempo de captura).
  const evidence = useMemo(() => {
    if (!evidenceRaw) return evidenceRaw;
    return evidenceRaw.slice().sort((a, b) => {
      const sa = a.step_index ?? Number.MAX_SAFE_INTEGER;
      const sb = b.step_index ?? Number.MAX_SAFE_INTEGER;
      return sa - sb || a.captured_at - b.captured_at;
    });
  }, [evidenceRaw]);

  const imageEvidence = useMemo(
    () =>
      (evidence ?? []).filter(
        (e) => e.file_id && (e.media_type ?? "image/").startsWith("image/"),
      ),
    [evidence],
  );

  return (
    <div className="space-y-4 rounded-xl border bg-muted/40 p-4">
      <div className="flex flex-wrap gap-2">
        <MetaChip label="Classe" value={finding.weakness_class} />
        <MetaChip label="CVSS" value={finding.cvss_vector} mono />
        <MetaChip label="CWE" value={finding.cwe} mono />
      </div>
      {finding.narrative && (
        <EvBlock label="Narrativa" text={finding.narrative} />
      )}
      {finding.description && (
        <EvBlock label="Descrição" text={finding.description} />
      )}
      {finding.impact && <EvBlock label="Impacto" text={finding.impact} />}
      {finding.remediation && (
        <EvBlock label="Remediação" text={finding.remediation} />
      )}

      {imageEvidence.length > 0 && (
        <div>
          <SubHead
            icon={ImageIcon}
            label="Evidência visual"
            n={imageEvidence.length}
          />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {imageEvidence.map((ev) => (
              <a
                key={ev._id}
                href={`/api/evidence/${ev._id}/image`}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir em tamanho real"
                className="group relative block overflow-hidden rounded-xl border bg-[#0e1b2e] shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/evidence/${ev._id}/image`}
                  alt={ev.label ?? "screenshot"}
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover"
                  onError={(e) => {
                    const a = e.currentTarget.closest("a");
                    if (a) (a as HTMLElement).style.display = "none";
                  }}
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-[#080f1b]/85 to-transparent px-2 pb-1.5 pt-5 font-mono text-[9.5px] text-[#cdd9ec]">
                  {ev.label ?? "screenshot"}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <div>
        <SubHead
          icon={ListOrdered}
          label="Cadeia de evidência"
          n={evidence?.length ?? 0}
        />
        {evidence === undefined ? (
          <div className="text-xs text-muted-foreground">Carregando…</div>
        ) : evidence.length === 0 ? (
          <Callout tone="warning">
            Sem evidência — aprovar exige ao menos uma evidência.
          </Callout>
        ) : (
          <div className="relative pl-1">
            {evidence.map((ev, i) => (
              <div
                key={ev._id}
                className="relative flex gap-3.5 pb-4 last:pb-0"
              >
                {i < evidence.length - 1 && (
                  <span className="absolute bottom-0 left-[13px] top-8 w-0.5 bg-border" />
                )}
                <span className="z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-xs font-bold text-primary shadow-[var(--shadow-soft)]">
                  {ev.step_index ?? i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    {ev.tool_name && (
                      <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-primary">
                        {ev.tool_name}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {ev.source_type}
                      {ev.label ? ` · ${ev.label}` : ""}
                    </span>
                    {ev.file_id && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Paperclip className="h-3 w-3" /> arquivo
                      </span>
                    )}
                  </div>
                  {ev.command && (
                    <pre className="overflow-auto rounded-lg bg-[#0e1b2e] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[#d5e0f2]">
                      <span className="select-none text-[#5f7fb0]">$ </span>
                      {ev.command}
                    </pre>
                  )}
                  {ev.snippet && (
                    <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-card px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {ev.snippet}
                    </pre>
                  )}
                  {ev.result_summary && (
                    <div className="mt-1.5 flex gap-1.5 text-xs">
                      <span className="font-semibold text-success">
                        → prova:
                      </span>
                      <span className="text-foreground/80">
                        {ev.result_summary}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetaChip({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 shadow-[var(--shadow-soft)]">
      <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn("break-all text-xs text-foreground", mono && "font-mono")}
      >
        {value}
      </span>
    </div>
  );
}

function EvBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
        {label}
      </div>
      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground/80">
        {text}
      </p>
    </div>
  );
}

function SubHead({
  icon: Icon,
  label,
  n,
}: {
  icon: LucideIcon;
  label: string;
  n: number;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
        {n}
      </span>
    </div>
  );
}
