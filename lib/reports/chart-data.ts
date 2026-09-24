import type {
  ChartData,
  Kpis,
  ReportFindingView,
  RiskMatrixCell,
  Severity,
  SeverityDatum,
} from "./report-model";
import { SEVERITY_ORDER } from "./report-model";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 100,
  high: 70,
  medium: 40,
  low: 15,
  info: 3,
};

// Aproxima a posição na matriz 5x5 (likelihood × impact) a partir da severidade
// quando não há decomposição CVSS detalhada — suficiente para a visão de matriz.
const SEVERITY_MATRIX: Record<
  Severity,
  { likelihood: RiskMatrixCell["likelihood"]; impact: RiskMatrixCell["impact"] }
> = {
  critical: { likelihood: 5, impact: 5 },
  high: { likelihood: 4, impact: 4 },
  medium: { likelihood: 3, impact: 3 },
  low: { likelihood: 2, impact: 2 },
  info: { likelihood: 1, impact: 1 },
};

export function computeKpis(findings: ReportFindingView[]): Kpis {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  let cvssSum = 0;
  let cvssCount = 0;
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    if (typeof f.cvssScore === "number" && Number.isFinite(f.cvssScore)) {
      cvssSum += f.cvssScore;
      cvssCount += 1;
    }
  }
  const total = findings.length;
  let weighted = 0;
  for (const s of SEVERITY_ORDER)
    weighted += bySeverity[s] * SEVERITY_WEIGHT[s];
  const worst = findings.reduce(
    (m, f) => Math.max(m, SEVERITY_WEIGHT[f.severity]),
    0,
  );
  const avg = total > 0 ? weighted / total : 0;
  const riskScore = Math.round(Math.min(100, 0.6 * worst + 0.4 * avg));
  return {
    total,
    bySeverity,
    avgCvss: cvssCount > 0 ? Math.round((cvssSum / cvssCount) * 10) / 10 : null,
    riskScore,
  };
}

export function computeChartData(findings: ReportFindingView[]): ChartData {
  const bySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const matrix = new Map<string, RiskMatrixCell>();
  for (const f of findings) {
    bySeverity[f.severity] += 1;
    const pos = SEVERITY_MATRIX[f.severity];
    const key = `${pos.likelihood}:${pos.impact}`;
    const cell = matrix.get(key) ?? {
      likelihood: pos.likelihood,
      impact: pos.impact,
      count: 0,
    };
    cell.count += 1;
    matrix.set(key, cell);
  }
  const severityDistribution: SeverityDatum[] = SEVERITY_ORDER.map(
    (severity) => ({ severity, count: bySeverity[severity] }),
  );
  return { severityDistribution, riskMatrix: Array.from(matrix.values()) };
}
