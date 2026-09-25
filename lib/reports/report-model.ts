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

/**
 * Marca do relatório — configurável por MSSP/cliente (resolvida por organização
 * no backend; cai para DEFAULT_BRAND — Suricatoos — quando não houver override).
 * Alimenta a casca de "dossiê" (código de documento, selo, rodapé numerado,
 * paleta, wordmark) nos três renderers. Hex SEM '#'.
 */
export type ReportBrand = {
  name: string; // "NetDeep Security" / "Suricatoos"
  wordmark: string; // marca curta p/ capa/divisória
  tagline?: string; // "Offensive Security · Red Team · MSSP"
  contact?: string; // "comercial@netdeep.com.br"
  docCodePrefix: string; // "NDP" → NDP-PTI-2026-0921
  primary: string; // cor primária (hex sem '#')
  accent: string; // cor de destaque (hex sem '#')
  classification: string; // "CONFIDENCIAL · USO RESTRITO"
};

export type ReportEvidenceView = {
  sourceType: string;
  label?: string;
  snippet?: string;
  /** Cadeia estruturada: passo, ferramenta, comando, o que a saída prova. */
  stepIndex?: number;
  toolName?: string;
  command?: string;
  resultSummary?: string;
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
  /** Narrativa (storytelling) do achado. */
  narrative?: string;
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
  /**
   * Marca resolvida por org (backend); parcial — os campos ausentes caem para
   * DEFAULT_BRAND no builder. Ausente por completo → DEFAULT_BRAND.
   */
  brand?: Partial<ReportBrand>;
  /** Sequência estável p/ o código do documento (deriva do engajamento). */
  docSeq?: number;
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

/** Item de estatística-herói (capa / panorama). */
export type StatItem = { value: string; label: string };
/** Passo de uma raia da cadeia de ataque (fluxo horizontal com setas). */
export type ChainStep = { label: string; detail?: string };
export type AttackLane = { title: string; steps: ChainStep[] };
/** Janela do roadmap de remediação (4 fases). */
export type RoadmapPhase = { window: string; label: string; actions: string[] };
/** Linha da coluna "incidente" no comparativo custo × incidente. */
export type CostItem = { label: string; detail?: string };
/** Ponto de valor ("Por que [MSSP]"). */
export type ValuePoint = { title: string; body: string };

export type Section =
  | { type: "cover"; title: string; subtitle?: string; stats?: StatItem[] }
  | {
      type: "partDivider";
      part: string;
      title: string;
      subtitle?: string;
    }
  | { type: "heading"; text: string; level: 1 | 2 }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | {
      type: "statBand";
      headline?: string;
      body?: string;
      stats: StatItem[];
    }
  | { type: "kpis"; kpis: Kpis }
  | { type: "severityChart"; data: ChartData }
  | { type: "riskMatrix"; data: ChartData }
  | { type: "attackChain"; lanes: AttackLane[] }
  | { type: "findingCard"; finding: ReportFindingView; showPoc: boolean }
  | { type: "findingsTable"; findings: ReportFindingView[] }
  | { type: "remediationMatrix"; findings: ReportFindingView[] }
  | { type: "roadmap"; phases: RoadmapPhase[] }
  | { type: "costVsIncident"; remediation: string[]; incident: CostItem[] }
  | { type: "partnerValue"; title: string; points: ValuePoint[] }
  | { type: "nextSteps"; steps: string[] }
  | { type: "callout"; tone: CalloutTone; text: string }
  | { type: "divider" };

export type SectionType = Section["type"];

export const ALL_SECTION_TYPES: readonly SectionType[] = [
  "cover",
  "partDivider",
  "heading",
  "paragraph",
  "bullets",
  "statBand",
  "kpis",
  "severityChart",
  "riskMatrix",
  "attackChain",
  "findingCard",
  "findingsTable",
  "remediationMatrix",
  "roadmap",
  "costVsIncident",
  "partnerValue",
  "nextSteps",
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
    /** Marca resolvida (sempre presente no modelo final). */
    brand: ReportBrand;
    /** Código do documento, ex.: "NDP-PTI-2026-0921". */
    docCode: string;
    /** Rótulo do volume, ex.: "DOSSIÊ · VOL. I". */
    volume: string;
  };
  kpis: Kpis;
  charts: ChartData;
  sections: Section[];
};

/** Marca padrão da plataforma (Suricatoos) — usada quando a org não define. */
export const DEFAULT_BRAND: ReportBrand = {
  name: "Suricatoos",
  wordmark: "Suricatoos",
  tagline: "Offensive Security · Pentest · MSSP",
  docCodePrefix: "SCT",
  primary: "2456E6",
  accent: "FF7678",
  classification: "CONFIDENCIAL · USO RESTRITO",
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
