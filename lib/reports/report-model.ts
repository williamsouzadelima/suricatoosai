/**
 * ReportModel — contrato ÚNICO, agnóstico de formato, que alimenta os três
 * renderers (docx/pptx/pdf). A lógica de público + textos pt-BR vivem aqui
 * (TS, no app); os renderers só percorrem `sections` por `type`. Um teste de
 * contrato garante que todo renderer trata todo Section.type (evita drift).
 *
 * Estrutura das seções espelha os modelos premium validados (Granado v3):
 * técnico/executivo/comercial. NENHUM dado de cliente é hardcoded aqui — só a
 * METODOLOGIA/estrutura; o conteúdo vem de ReportInput em runtime.
 */

export type ReportAudience = "technical" | "executive" | "commercial";
export type ReportFormat = "docx" | "pptx" | "pdf";
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type ReportEvidenceView = {
  sourceType: string;
  label?: string;
  snippet?: string;
  /**
   * Caminho LOCAL (relativo à raiz do renderer no sandbox) de uma evidência em
   * imagem, quando houver. O job do trigger baixa o arquivo do S3 e preenche
   * este campo antes de montar o modelo; os renderers embutem a imagem. Ausente
   * fora do job (ex.: amostras locais) → renderer ignora graciosamente.
   */
  imagePath?: string;
};

export type ReportFindingView = {
  ref: string; // finding_id, ex.: "F-a1b2c"
  title: string;
  severity: Severity;
  affectedAsset: string;
  weaknessClass: string;
  cwe?: string;
  cvssVector?: string;
  cvssScore?: number;
  description?: string;
  impact?: string;
  remediation?: string;
  reproductionSteps?: string[];
  evidence: ReportEvidenceView[];
};

export type ReportScopeItem = {
  kind: string;
  value: string;
  inScope: boolean;
};

export type ReportInput = {
  client: { name: string };
  engagement: {
    name: string;
    code?: string;
    status: string;
    startsAt?: number;
    endsAt?: number;
    scope?: ReportScopeItem[];
  };
  author: string;
  generatedAt: number;
  version: number;
  /** Somente achados aprovados/publicados entram no relatório. */
  findings: ReportFindingView[];
};

export type Kpis = {
  total: number;
  bySeverity: Record<Severity, number>;
  avgCvss: number | null;
  /** 0–100, derivado da distribuição de severidade. */
  riskScore: number;
};

export type SeverityDatum = { severity: Severity; count: number };
export type RiskMatrixCell = {
  likelihood: 1 | 2 | 3 | 4 | 5;
  impact: 1 | 2 | 3 | 4 | 5;
  count: number;
};
export type ChartData = {
  severityDistribution: SeverityDatum[];
  riskMatrix: RiskMatrixCell[];
};

export type CalloutTone = "info" | "warning" | "critical" | "success";

export type Section =
  | { type: "cover"; title: string; subtitle?: string }
  | { type: "heading"; text: string; level: 1 | 2 }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "kpis"; kpis: Kpis }
  | { type: "severityChart"; data: ChartData }
  | { type: "riskMatrix"; data: ChartData }
  | { type: "findingCard"; finding: ReportFindingView; showPoc: boolean }
  | { type: "findingsTable"; findings: ReportFindingView[] }
  | { type: "remediationMatrix"; findings: ReportFindingView[] }
  | { type: "callout"; tone: CalloutTone; text: string }
  | { type: "divider" };

export type SectionType = Section["type"];

export const ALL_SECTION_TYPES: readonly SectionType[] = [
  "cover",
  "heading",
  "paragraph",
  "bullets",
  "kpis",
  "severityChart",
  "riskMatrix",
  "findingCard",
  "findingsTable",
  "remediationMatrix",
  "callout",
  "divider",
] as const;

export type ReportModel = {
  meta: {
    client: string;
    engagement: string;
    audience: ReportAudience;
    author: string;
    generatedAt: number;
    version: number;
    classification: string;
  };
  kpis: Kpis;
  charts: ChartData;
  sections: Section[];
};

export const SEVERITY_ORDER: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const SEVERITY_LABEL_PT: Record<Severity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
  info: "Informativo",
};
