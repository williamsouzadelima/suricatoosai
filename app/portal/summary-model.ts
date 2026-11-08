/**
 * Modelo PURO do resumo de portfólio do portal (Fase 1b) — regras de frase,
 * tom, pluralização e rótulos client-facing. Sem React, sem Convex (só tipos).
 * A UI (retida até a conferência visual do William) consome isto; os testes
 * asseguram a honestidade das frases (nunca "score"/"nota"/"tendência").
 *
 * Reexporta o comparador/ordenação de convex/lib/portalSummary → FONTE ÚNICA
 * (o servidor e a UI ordenam idêntico; sem divergência de desempate).
 */
import type { PortalSummary } from "@/convex/lib/portalSummary";
import { EVIDENCE_COUNT_CAP } from "@/convex/lib/portalSummary";

export {
  comparePriority,
  selectPriorityOrder,
  worstOpenSeverity,
  SEV_RANK,
  SEVERITIES,
} from "@/convex/lib/portalSummary";
export type {
  PortalSummary,
  PriorityItem,
  PerEngagementRow,
} from "@/convex/lib/portalSummary";

export type HeroTone = "destructive" | "success" | "neutral" | "muted";

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Numeral do herói: "—" sem publicados; senão críticos+altos EM ABERTO
 *  (0 quando nada aberto ou nada crítico/alto). Nunca aparece sem a frase. */
export function heroNumeral(s: PortalSummary): string {
  if (s.findings.published === 0) return "—";
  return String(s.findings.openCriticalHigh);
}

/** Cobertura total = TODO engajamento visível tem achado publicado E a leitura
 *  não truncou. Só então "sem achados em aberto" pode ser VERDE (sucesso); senão
 *  o verde seria um falso "tudo certo" que ignora o que nunca foi reportado. */
export function isFullCoverage(s: PortalSummary): boolean {
  return s.engagements.withFindings === s.engagements.total && !s.truncated;
}

export function heroTone(s: PortalSummary): HeroTone {
  const f = s.findings;
  if (f.published === 0) return "muted";
  if (f.openCriticalHigh > 0) return "destructive";
  if (f.open === 0 && isFullCoverage(s)) return "success";
  return "neutral";
}

/**
 * Frase do herói — SEMPRE acompanha o numeral (nunca um número solto). Diz a
 * base (só publicados) e o que foi contado. Ausência NÃO vira "tudo limpo", e o
 * verde de "nada em aberto" só sai com cobertura total (senão é falso all-clear).
 */
export function heroSentence(s: PortalSummary): string {
  const f = s.findings;
  const { total, withFindings } = s.engagements;
  if (f.published === 0) {
    return "Nenhum achado publicado neste portfólio ainda.";
  }
  if (f.open === 0) {
    if (withFindings < total) {
      return `${withFindings} de ${total} ${plural(
        total,
        "engajamento",
        "engajamentos",
      )} com achados publicados; os demais ainda sem publicação.`;
    }
    if (s.truncated) {
      return "Nenhum achado em aberto entre os achados carregados; resumo parcial.";
    }
    return f.published === 1
      ? "Nenhum achado em aberto: o único achado publicado foi validado por reteste."
      : `Nenhum achado em aberto: todos os ${f.published} achados publicados foram validados por reteste.`;
  }
  if (f.openCriticalHigh === 0) {
    return `${f.open} ${plural(f.open, "achado em aberto", "achados em aberto")}, nenhum crítico ou alto.`;
  }
  const c = f.openBySeverity.critical;
  const h = f.openBySeverity.high;
  const sv = f.retest.stillVulnerable;
  const base = `${f.open} de ${f.published} publicados seguem em aberto: ${c} ${plural(
    c,
    "crítico",
    "críticos",
  )} e ${h} ${plural(h, "alto", "altos")}.`;
  return sv > 0
    ? `${base} ${sv} ${plural(
        sv,
        "confirmado ainda vulnerável",
        "confirmados ainda vulneráveis",
      )} no reteste.`
    : base;
}

/** Rótulo de reteste no PORTAL (vocabulário único client-facing). NÃO edita o
 *  RETEST_BADGE compartilhado do operador ("Corrigido" lá segue intocado). */
export function retestPortalLabel(status: string | null): string {
  switch (status) {
    case "fixed":
      return "Validado por reteste";
    case "still_vulnerable":
      return "Ainda vulnerável";
    case "pending":
      return "Reteste pendente";
    default:
      return "Sem reteste";
  }
}

/** Cobertura do registro — "x de y", nunca percentual; "não informado" ≠ "sem alvos". */
export function scopeCoverageLine(withScope: number, total: number): string {
  return `Escopo registrado em ${withScope} de ${total}`;
}
export function windowCoverageLine(withWindow: number, total: number): string {
  return `Janela registrada em ${withWindow} de ${total}`;
}

export const SUMMARY_ERROR_COPY =
  "Não foi possível carregar o resumo de achados: serviço indisponível. Isso não significa ausência de achados.";
export const SUMMARY_TRUNCATED_COPY =
  "Resumo parcial: o volume excede o limite de leitura; os números podem estar incompletos.";
export const RISK_UNAVAILABLE_COPY = "Riscos indisponíveis agora";

/** Aviso de resumo parcial (o volume estourou o teto de leitura por engajamento).
 *  null quando completo. A UI mostra como Callout de atenção acima dos números. */
export function truncationNotice(s: PortalSummary): string | null {
  return s.truncated ? SUMMARY_TRUNCATED_COPY : null;
}

/** evidenceCount honesto no teto: "200+" quando bateu o limite de leitura. */
export function formatEvidenceCount(n: number): string {
  return n >= EVIDENCE_COUNT_CAP ? `${EVIDENCE_COUNT_CAP}+` : String(n);
}
