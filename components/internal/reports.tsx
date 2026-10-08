// Constantes/tipos compartilhados de RELATÓRIOS dos painéis internos
// (/engagements e /relatorios). Fonte única — igual a components/internal/findings.
// Só tipos e mapas (sem hooks); seguro importar de client ou server component.

import type { Id } from "@/convex/_generated/dataModel";
import type { Tone } from "@/app/admin/_ui";

export type ReportAudience =
  "technical" | "executive" | "commercial" | "action_plan";
export type ReportFormat = "docx" | "pptx" | "pdf";
export type ReportStatus = "queued" | "rendering" | "ready" | "failed";

export const AUDIENCE_LABEL: Record<ReportAudience, string> = {
  technical: "Técnico",
  executive: "Executivo",
  commercial: "Ações comerciais",
  action_plan: "Plano de Ação",
};

export const AUDIENCE_DESC: Record<ReportAudience, string> = {
  technical: "Achados, evidência e reprodução",
  executive: "Risco e postura para a diretoria",
  commercial: "Proposta, escopo e valor",
  action_plan: "Remediação priorizada com prazo-alvo",
};

export const REPORT_STATUS_TONE: Record<ReportStatus, Tone> = {
  queued: "neutral",
  rendering: "warning",
  ready: "success",
  failed: "destructive",
};

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  queued: "Na fila",
  rendering: "Gerando…",
  ready: "Pronto",
  failed: "Falhou",
};

export const ALL_FORMATS: ReportFormat[] = ["docx", "pptx", "pdf"];

/** A geração sob demanda cobre estas audiences (reportAudienceValidator). */
export const GENERATABLE_AUDIENCES: ReportAudience[] = [
  "technical",
  "executive",
  "commercial",
  "action_plan",
];

export type ReportRow = {
  _id: Id<"reports">;
  report_group_id: string;
  audience: string;
  format: string;
  version: number;
  status: string;
  error?: string;
  size_bytes?: number;
  title?: string;
  // Visibilidade no portal do cliente: ausente/true = visível; false = oculto.
  client_visible?: boolean;
  created_at: number;
};
