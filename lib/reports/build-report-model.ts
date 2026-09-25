import { computeChartData, computeKpis } from "./chart-data";
import {
  DEFAULT_BRAND,
  SEVERITY_LABEL_PT,
  SEVERITY_ORDER,
  type AttackLane,
  type CostItem,
  type Kpis,
  type ReportAudience,
  type ReportBrand,
  type ReportFindingView,
  type ReportInput,
  type ReportModel,
  type RoadmapPhase,
  type Section,
  type Severity,
  type StatItem,
  type ValuePoint,
} from "./report-model";

function fmtDate(ms?: number): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS_PT = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

function monthYearPt(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_PT[d.getUTCMonth()]} · ${d.getUTCFullYear()}`;
}

function clip(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
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

function resolveBrand(input: ReportInput): ReportBrand {
  // Mescla o override parcial da org sobre a marca padrão (campos vazios/ausentes
  // caem para DEFAULT_BRAND). Ignora strings vazias vindas do banco.
  const partial = input.brand ?? {};
  const clean = Object.fromEntries(
    Object.entries(partial).filter(([, v]) => v != null && v !== ""),
  );
  return { ...DEFAULT_BRAND, ...clean };
}

/** Hash determinístico (sem node:crypto) p/ derivar o nº do documento. */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** NDP-PTI-2026-0921 — prefixo da marca + PTI + ano + sequência estável. */
function docCode(brand: ReportBrand, input: ReportInput): string {
  const year = new Date(input.generatedAt).getUTCFullYear();
  const seedStr = `${input.engagement.code ?? ""}|${input.engagement.name}|${input.client.name}`;
  const seq = input.docSeq ?? strHash(seedStr) % 10000;
  const seq4 = String(seq).padStart(4, "0");
  return `${brand.docCodePrefix}-PTI-${year}-${seq4}`;
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

function maxCvss(findings: ReportFindingView[]): number | null {
  let m: number | null = null;
  for (const f of findings) {
    if (typeof f.cvssScore === "number" && Number.isFinite(f.cvssScore)) {
      m = m === null ? f.cvssScore : Math.max(m, f.cvssScore);
    }
  }
  return m;
}

function distinctAssets(findings: ReportFindingView[]): number {
  return new Set(
    findings
      .map((f) => (f.affectedAsset || "").trim().toLowerCase())
      .filter(Boolean),
  ).size;
}

/** Faixa de KPIs-herói da capa/panorama — sempre derivada dos dados reais. */
function coverStats(kpis: Kpis, input: ReportInput): StatItem[] {
  const stats: StatItem[] = [
    { value: String(kpis.total), label: "ACHADOS" },
    { value: String(kpis.bySeverity.critical), label: "CRÍTICOS" },
  ];
  const mc = maxCvss(input.findings);
  if (mc !== null) stats.push({ value: mc.toFixed(1), label: "MAIOR CVSS" });
  const assets = distinctAssets(input.findings);
  if (assets > 0)
    stats.push({ value: String(assets), label: "ATIVOS AFETADOS" });
  return stats.slice(0, 4);
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

/**
 * Cadeia de ataque — uma raia por achado crítico/alto com cadeia de evidência,
 * cada passo derivado da ferramenta/comando reais capturados. Fluxo horizontal
 * (renderer desenha as setas). Honesto: nada fabricado.
 */
function attackLanes(findings: ReportFindingView[]): AttackLane[] {
  const lanes: AttackLane[] = [];
  const ranked = sortBySeverity(
    findings.filter((f) => f.severity === "critical" || f.severity === "high"),
  );
  for (const f of ranked) {
    const chain = [...(f.evidence || [])].sort(
      (a, b) =>
        (a.stepIndex ?? Number.MAX_SAFE_INTEGER) -
        (b.stepIndex ?? Number.MAX_SAFE_INTEGER),
    );
    let steps = chain
      .filter((e) => e.toolName || e.command || e.resultSummary)
      .slice(0, 5)
      .map((e) => ({
        label: clip(e.toolName || e.sourceType || "passo", 22),
        detail: clip(e.resultSummary || e.command || "", 40),
      }));
    if (steps.length === 0 && (f.reproductionSteps || []).length > 0) {
      steps = f.reproductionSteps!.slice(0, 5).map((s, i) => ({
        label: `Passo ${i + 1}`,
        detail: clip(s, 40),
      }));
    }
    if (steps.length === 0) continue;
    lanes.push({ title: `${f.ref} · ${clip(f.title, 48)}`, steps });
    if (lanes.length >= 3) break;
  }
  return lanes;
}

/** Roadmap 4 janelas — ações reais de remediação bucketadas por severidade. */
function roadmapPhases(findings: ReportFindingView[]): RoadmapPhase[] {
  const rem = (sev: Severity[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const f of findings) {
      if (!sev.includes(f.severity)) continue;
      const r = (f.remediation || "").trim();
      // Ignora remediações vazias ou não-acionáveis ("N/A", "—", "informativo").
      if (!r || /^(n\/?a\b|—|-|informativo)/i.test(r)) continue;
      const key = r.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clip(r, 72));
      if (out.length >= 5) break;
    }
    return out;
  };
  const immediate = rem(["critical"]);
  const short = rem(["high"]);
  const medium = rem(["medium"]);
  const longActions = rem(["low", "info"]);
  longActions.push("Pentest de validação pós-correção");
  return [
    {
      window: "0 – 7 dias",
      label: "Contenção imediata",
      actions: immediate.length
        ? immediate
        : ["Revisar exposições críticas identificadas"],
    },
    {
      window: "8 – 30 dias",
      label: "Fechar vetores",
      actions: short.length ? short : ["Endereçar achados de severidade alta"],
    },
    {
      window: "31 – 90 dias",
      label: "Hardening estrutural",
      actions: medium.length
        ? medium
        : ["Hardening e correção dos itens de severidade média"],
    },
    {
      window: "91 – 180 dias",
      label: "Maturidade contínua",
      actions: longActions.slice(0, 5),
    },
  ];
}

/** Comparativo custo × incidente (comercial) — remediação real vs. consequência. */
function costVsIncident(findings: ReportFindingView[]): {
  remediation: string[];
  incident: CostItem[];
} {
  const phases = roadmapPhases(findings);
  const remediation = [...phases[0].actions, ...phases[1].actions].slice(0, 6);
  const has = (sev: Severity) => findings.some((f) => f.severity === sev);
  const text = findings
    .map((f) => `${f.title} ${f.weaknessClass} ${f.description ?? ""}`)
    .join(" ")
    .toLowerCase();
  const incident: CostItem[] = [];
  if (has("critical"))
    incident.push({
      label: "Comprometimento total do ambiente",
      detail: "parada operacional / ransomware sobre a organização",
    });
  if (/creden|senha|password|hash|ntds|kerbero|cleartext|texto/.test(text))
    incident.push({
      label: "Exfiltração de credenciais e dados",
      detail: "multa LGPD + dano reputacional",
    });
  if (/erp|banco|database|sql|dados de produ|financ|faturamento/.test(text))
    incident.push({
      label: "Acesso a dados de produção",
      detail: "vazamento de informação sensível do negócio",
    });
  incident.push({
    label: "Indisponibilidade de serviços",
    detail: "perda financeira por hora de operação parada",
  });
  return { remediation, incident: incident.slice(0, 4) };
}

/** "O que aconteceria" (comercial) — enquadramento de negócio dos críticos/altos. */
function businessScenarios(findings: ReportFindingView[]): string[] {
  const ch = sortBySeverity(
    findings.filter((f) => f.severity === "critical" || f.severity === "high"),
  ).slice(0, 4);
  if (ch.length === 0)
    return ["Postura sólida; sem cenários de risco crítico ativos."];
  return ch.map((f) => {
    const impact = (f.impact || "").trim();
    return impact
      ? `${clip(f.title, 60)} — ${clip(impact, 120)}`
      : clip(f.title, 140);
  });
}

/** "Por que [MSSP]" — pontos de valor, com a marca configurada. */
function partnerPoints(brand: ReportBrand): ValuePoint[] {
  return [
    {
      title: "Evidência, não opinião",
      body: "Cada achado vem com evidência bruta: saída de ferramenta, hashes, logs e screenshots. Não estimamos — provamos.",
    },
    {
      title: "Remediação acompanhada",
      body: `Não entregamos um relatório e sumimos. A ${brand.name} fica com você até o reteste de validação confirmar que os vetores fecharam.`,
    },
    {
      title: "Confidencialidade total",
      body: "Evidências sob controle de acesso, relatórios classificados e cadeia de custódia documentada para cada arquivo.",
    },
    {
      title: "Experiência ofensiva real",
      body: "Ataques encadeados, movimento lateral e pós-exploração controlada — a metodologia que um adversário real usaria.",
    },
  ];
}

const NEXT_STEPS = [
  "Reunião de kickoff de remediação",
  "Aprovação do plano priorizado",
  "Execução das ações imediatas (0 – 7 dias)",
  "Reteste de validação após a remediação (30 dias)",
];

function baseMeta(
  input: ReportInput,
  audience: ReportAudience,
): ReportModel["meta"] {
  const brand = resolveBrand(input);
  return {
    client: input.client.name,
    engagement: input.engagement.name,
    audience,
    author: input.author,
    generatedAt: input.generatedAt,
    version: input.version,
    classification: brand.classification,
    brand,
    docCode: docCode(brand, input),
    volume: "DOSSIÊ · VOL. I",
  };
}

// ── Técnico ────────────────────────────────────────────────────────────────
function buildTechnical(input: ReportInput): ReportModel {
  const kpis = computeKpis(input.findings);
  const charts = computeChartData(input.findings);
  const sorted = sortBySeverity(input.findings);
  const lanes = attackLanes(input.findings);
  const sections: Section[] = [
    {
      type: "cover",
      title: "Relatório Técnico de Teste de Intrusão",
      subtitle: `${input.client.name} — ${input.engagement.name}`,
      stats: coverStats(kpis, input),
    },
    { type: "partDivider", part: "PARTE I", title: "Sumário Executivo" },
    {
      type: "statBand",
      headline: riskPostureText(kpis),
      body: engagementStory(input, kpis),
      stats: coverStats(kpis, input),
    },
    { type: "kpis", kpis },
    { type: "severityChart", data: charts },
    { type: "heading", text: "Escopo & Metodologia", level: 1 },
    { type: "bullets", items: scopeBullets(input) },
    {
      type: "paragraph",
      text: "Metodologia alinhada a PTES/OWASP: reconhecimento, enumeração, exploração controlada, pós-exploração e validação. Cada achado abaixo traz evidência, impacto e remediação.",
    },
    {
      type: "partDivider",
      part: "PANORAMA",
      title: `Os ${kpis.total} achados, num relance`,
    },
    { type: "findingsTable", findings: sorted },
  ];
  if (lanes.length) {
    sections.push(
      { type: "partDivider", part: "PARTE II", title: "Cadeias de Ataque" },
      { type: "attackChain", lanes },
    );
  }
  sections.push({
    type: "partDivider",
    part: "PARTE III",
    title: "Achados Detalhados",
    subtitle: "Cada achado com severidade, CVSS, evidência e remediação",
  });
  for (const f of sorted) {
    sections.push({ type: "findingCard", finding: f, showPoc: true });
  }
  sections.push(
    { type: "partDivider", part: "REMEDIAÇÃO", title: "Plano por fase" },
    { type: "roadmap", phases: roadmapPhases(input.findings) },
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
  const lanes = attackLanes(input.findings);
  const topFindings = sorted
    .filter((f) => f.severity === "critical" || f.severity === "high")
    .slice(0, 3);
  const sections: Section[] = [
    {
      type: "cover",
      title: "Relatório Executivo de Pentest",
      subtitle: `${input.client.name} — ${input.engagement.name}`,
      stats: coverStats(kpis, input),
    },
    {
      type: "partDivider",
      part: "PANORAMA",
      title: "O domínio do engajamento, num relance",
    },
    {
      type: "statBand",
      headline: riskPostureText(kpis),
      body: engagementStory(input, kpis),
      stats: coverStats(kpis, input),
    },
    { type: "severityChart", data: charts },
  ];
  if (lanes.length) {
    sections.push(
      {
        type: "partDivider",
        part: "SE NÃO FOSSE UM TESTE AUTORIZADO",
        title: "O caminho até o controle",
      },
      { type: "attackChain", lanes },
    );
  }
  sections.push({
    type: "partDivider",
    part: "A PROVA",
    title: "Evidência, não opinião",
    subtitle: "Não estimamos. Provamos.",
  });
  for (const f of topFindings) {
    sections.push({ type: "findingCard", finding: f, showPoc: true });
  }
  sections.push(
    {
      type: "partDivider",
      part: "PANORAMA COMPLETO",
      title: `Todos os ${kpis.total} achados`,
    },
    { type: "findingsTable", findings: sorted },
    { type: "partDivider", part: "REMEDIAÇÃO", title: "Plano por fase" },
    { type: "roadmap", phases: roadmapPhases(input.findings) },
    { type: "nextSteps", steps: NEXT_STEPS },
    { type: "divider" },
  );
  return { meta: baseMeta(input, "executive"), kpis, charts, sections };
}

// ── Comercial (Plano de Ação) ──────────────────────────────────────────────
function buildCommercial(input: ReportInput): ReportModel {
  const kpis = computeKpis(input.findings);
  const charts = computeChartData(input.findings);
  const brand = resolveBrand(input);
  const criticalHigh = input.findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  );
  const cvi = costVsIncident(input.findings);
  const sections: Section[] = [
    {
      type: "cover",
      title: "Plano de Ação · Comercial",
      subtitle: `${input.client.name} — ${input.engagement.name}`,
      stats: coverStats(kpis, input),
    },
    {
      type: "partDivider",
      part: "SITUAÇÃO CONFIRMADA POR EVIDÊNCIA",
      title: "O cenário que encontramos",
    },
    {
      type: "statBand",
      headline: riskPostureText(kpis),
      body: `O teste identificou ${kpis.total} oportunidade(s) de melhoria de segurança (${severitySummaryPhrase(kpis)}).`,
      stats: coverStats(kpis, input),
    },
    {
      type: "callout",
      tone: criticalHigh.length > 0 ? "critical" : "info",
      text:
        criticalHigh.length > 0
          ? `${criticalHigh.length} risco(s) de severidade alta/crítica exigem ação imediata.`
          : "Sem riscos críticos ativos; foco em hardening contínuo.",
    },
    {
      type: "partDivider",
      part: "SE NÃO FOSSE UM TESTE AUTORIZADO",
      title: "O que aconteceria",
    },
    { type: "bullets", items: businessScenarios(input.findings) },
    {
      type: "partDivider",
      part: "REMEDIAÇÃO",
      title: "O caminho de volta ao controle",
    },
    { type: "roadmap", phases: roadmapPhases(input.findings) },
    {
      type: "partDivider",
      part: "A CONTA QUE IMPORTA",
      title: "Custo da remediação vs. custo do incidente",
    },
    {
      type: "costVsIncident",
      remediation: cvi.remediation,
      incident: cvi.incident,
    },
    {
      type: "partDivider",
      part: "PARCERIA DE REMEDIAÇÃO",
      title: `Por que a ${brand.name}`,
    },
    {
      type: "partnerValue",
      title: `Por que a ${brand.name}`,
      points: partnerPoints(brand),
    },
    { type: "nextSteps", steps: NEXT_STEPS },
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
