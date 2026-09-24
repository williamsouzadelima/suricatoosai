import { computeChartData, computeKpis } from "./chart-data";
import {
  SEVERITY_LABEL_PT,
  SEVERITY_ORDER,
  type Kpis,
  type ReportAudience,
  type ReportFindingView,
  type ReportInput,
  type ReportModel,
  type Section,
  type Severity,
} from "./report-model";

const CLASSIFICATION = "Confidencial — uso restrito ao cliente";

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

function sevRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

function sortBySeverity(findings: ReportFindingView[]): ReportFindingView[] {
  return [...findings].sort(
    (a, b) => sevRank(a.severity) - sevRank(b.severity),
  );
}

function period(input: ReportInput): string {
  const { startsAt, endsAt } = input.engagement;
  if (!startsAt && !endsAt) return "período não informado";
  return `${fmtDate(startsAt)} a ${fmtDate(endsAt)}`;
}

function severitySummaryPhrase(kpis: Kpis): string {
  const parts = SEVERITY_ORDER.filter((s) => kpis.bySeverity[s] > 0).map(
    (s) => `${kpis.bySeverity[s]} ${SEVERITY_LABEL_PT[s].toLowerCase()}`,
  );
  if (parts.length === 0) return "nenhum achado registrado";
  return parts.join(", ");
}

function riskPostureText(kpis: Kpis): string {
  if (kpis.riskScore >= 80)
    return "Postura de risco CRÍTICA: há exposição que exige ação imediata.";
  if (kpis.riskScore >= 55)
    return "Postura de risco ALTA: correções prioritárias são necessárias.";
  if (kpis.riskScore >= 30)
    return "Postura de risco MODERADA: há itens relevantes a endereçar.";
  return "Postura de risco BAIXA: predominam itens de hardening.";
}

function baseMeta(
  input: ReportInput,
  audience: ReportAudience,
): ReportModel["meta"] {
  return {
    client: input.client.name,
    engagement: input.engagement.name,
    audience,
    author: input.author,
    generatedAt: input.generatedAt,
    version: input.version,
    classification: CLASSIFICATION,
  };
}

function engagementStory(input: ReportInput, kpis: Kpis): string {
  return `Este documento consolida o engajamento "${input.engagement.name}" do cliente ${input.client.name} (${period(input)}). Foram registrados ${kpis.total} achado(s): ${severitySummaryPhrase(kpis)}. ${riskPostureText(kpis)}`;
}

function scopeBullets(input: ReportInput): string[] {
  const scope = input.engagement.scope ?? [];
  const inScope = scope.filter((s) => s.inScope).map((s) => s.value);
  const out = scope.filter((s) => !s.inScope).map((s) => s.value);
  const bullets: string[] = [];
  if (inScope.length) bullets.push(`Em escopo: ${inScope.join(", ")}`);
  if (out.length) bullets.push(`Fora de escopo: ${out.join(", ")}`);
  if (bullets.length === 0)
    bullets.push("Escopo conforme contrato do engajamento.");
  return bullets;
}

function hardeningBullets(findings: ReportFindingView[]): string[] {
  const minor = findings.filter(
    (f) =>
      f.severity === "medium" || f.severity === "low" || f.severity === "info",
  );
  if (minor.length === 0)
    return ["Nenhum item de hardening de menor severidade registrado."];
  return minor.map(
    (f) => `${SEVERITY_LABEL_PT[f.severity]} · ${f.title} (${f.affectedAsset})`,
  );
}

// ── Técnico ────────────────────────────────────────────────────────────────
function buildTechnical(input: ReportInput): ReportModel {
  const kpis = computeKpis(input.findings);
  const charts = computeChartData(input.findings);
  const sorted = sortBySeverity(input.findings);
  const sections: Section[] = [
    {
      type: "cover",
      title: "Relatório Técnico · Pentest",
      subtitle: `${input.client.name} — ${input.engagement.name}`,
    },
    { type: "heading", text: "Resumo Executivo", level: 1 },
    { type: "kpis", kpis },
    { type: "severityChart", data: charts },
    { type: "heading", text: "A História do Engajamento", level: 1 },
    { type: "paragraph", text: engagementStory(input, kpis) },
    { type: "heading", text: "Escopo & Metodologia", level: 1 },
    { type: "bullets", items: scopeBullets(input) },
    {
      type: "paragraph",
      text: "Metodologia alinhada a PTES/OWASP: reconhecimento, enumeração, exploração controlada, pós-exploração e validação. Cada achado abaixo traz evidência, impacto e remediação.",
    },
    { type: "heading", text: "Sumário de Achados", level: 1 },
    { type: "findingsTable", findings: sorted },
  ];
  for (const f of sorted) {
    sections.push({ type: "findingCard", finding: f, showPoc: true });
  }
  sections.push(
    { type: "heading", text: "Médios & Baixo — Hardening", level: 1 },
    { type: "bullets", items: hardeningBullets(input.findings) },
    { type: "heading", text: "Cadeia de Ataque", level: 1 },
    {
      type: "paragraph",
      text: "Encadeamento dos achados de maior severidade demonstrando o caminho de comprometimento observado durante o teste.",
    },
    { type: "heading", text: "Matriz de Remediação Priorizada", level: 1 },
    { type: "remediationMatrix", findings: sorted },
    { type: "divider" },
  );
  return { meta: baseMeta(input, "technical"), kpis, charts, sections };
}

// ── Executivo ────────────────────────────────────────────────────────────
function buildExecutive(input: ReportInput): ReportModel {
  const kpis = computeKpis(input.findings);
  const charts = computeChartData(input.findings);
  const sorted = sortBySeverity(input.findings);
  const topCritical = sorted.find((f) => f.severity === "critical");
  const topHigh = sorted.find((f) => f.severity === "high");
  const sections: Section[] = [
    {
      type: "cover",
      title: "Relatório Executivo · Pentest",
      subtitle: `${input.client.name} — ${input.engagement.name}`,
    },
    { type: "heading", text: "Resumo Executivo", level: 1 },
    { type: "kpis", kpis },
    {
      type: "callout",
      tone:
        kpis.riskScore >= 55
          ? "critical"
          : kpis.riskScore >= 30
            ? "warning"
            : "success",
      text: riskPostureText(kpis),
    },
    { type: "heading", text: "A História do Engajamento", level: 1 },
    { type: "paragraph", text: engagementStory(input, kpis) },
    { type: "heading", text: "Sumário de Achados", level: 1 },
    { type: "severityChart", data: charts },
    { type: "findingsTable", findings: sorted },
  ];
  if (topCritical) {
    sections.push({ type: "heading", text: "Achado Crítico", level: 1 });
    sections.push({
      type: "findingCard",
      finding: topCritical,
      showPoc: false,
    });
  }
  if (topHigh) {
    sections.push({ type: "heading", text: "Achado Alto", level: 1 });
    sections.push({ type: "findingCard", finding: topHigh, showPoc: false });
  }
  sections.push(
    { type: "heading", text: "Médios & Baixo — Hardening", level: 1 },
    { type: "bullets", items: hardeningBullets(input.findings) },
    { type: "heading", text: "Cadeia de Ataque", level: 1 },
    {
      type: "paragraph",
      text: "Visão de alto nível de como os achados se conectam em um caminho de risco ao negócio.",
    },
    { type: "heading", text: "Matriz de Remediação Priorizada", level: 1 },
    { type: "remediationMatrix", findings: sorted },
    { type: "divider" },
  );
  return { meta: baseMeta(input, "executive"), kpis, charts, sections };
}

// ── Comercial (Plano de Ação) ──────────────────────────────────────────────
function buildCommercial(input: ReportInput): ReportModel {
  const kpis = computeKpis(input.findings);
  const charts = computeChartData(input.findings);
  const criticalHigh = input.findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  const sections: Section[] = [
    {
      type: "cover",
      title: "Plano de Ação Comercial",
      subtitle: `${input.client.name} — ${input.engagement.name}`,
    },
    { type: "heading", text: "O Que o Teste de Segurança Revelou", level: 1 },
    { type: "kpis", kpis },
    {
      type: "paragraph",
      text: `O teste identificou ${kpis.total} oportunidade(s) de melhoria de segurança (${severitySummaryPhrase(kpis)}). ${riskPostureText(kpis)}`,
    },
    { type: "heading", text: "Situação Ativa — Ação Necessária", level: 1 },
    {
      type: "callout",
      tone: criticalHigh.length > 0 ? "critical" : "info",
      text:
        criticalHigh.length > 0
          ? `${criticalHigh.length} risco(s) de severidade alta/crítica exigem ação imediata.`
          : "Sem riscos críticos ativos; foco em hardening contínuo.",
    },
    {
      type: "bullets",
      items:
        criticalHigh.length > 0
          ? criticalHigh.map(
              (f) => `${SEVERITY_LABEL_PT[f.severity]} · ${f.title}`,
            )
          : ["Postura sólida; recomenda-se monitoramento contínuo."],
    },
    { type: "heading", text: "A Prova", level: 1 },
    {
      type: "paragraph",
      text: "Cada risco acima foi validado com evidência técnica reproduzível (detalhada no relatório técnico).",
    },
    {
      type: "heading",
      text: "Oportunidades de Serviço Identificadas",
      level: 1,
    },
    {
      type: "bullets",
      items: [
        "Remediação assistida dos achados priorizados",
        "Reteste de validação pós-correção",
        "Monitoramento contínuo de superfície externa",
      ],
    },
    { type: "heading", text: "Pacote de Serviços Recomendado", level: 1 },
    {
      type: "bullets",
      items: [
        "Sprint de remediação (acompanhamento técnico)",
        "Reteste focado nos achados críticos/altos",
        "Assinatura de monitoramento + reavaliação periódica",
      ],
    },
    { type: "heading", text: "Próximos Passos", level: 1 },
    {
      type: "bullets",
      items: [
        "Aprovar o plano de remediação priorizado",
        "Agendar o reteste de validação",
        "Definir cadência de monitoramento contínuo",
      ],
    },
  ];
  return { meta: baseMeta(input, "commercial"), kpis, charts, sections };
}

export function buildReportModel(
  audience: ReportAudience,
  input: ReportInput,
): ReportModel {
  switch (audience) {
    case "technical":
      return buildTechnical(input);
    case "executive":
      return buildExecutive(input);
    case "commercial":
      return buildCommercial(input);
  }
}
