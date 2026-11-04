// Apresentação de ACHADOS — fonte única, PURA (sem "use client", sem convex,
// sem next-intl). Tipos + mapas de classe Tailwind + rótulos pt-BR + glossário
// de severidade/status. Qualquer superfície (painel interno OU portal do
// cliente) monta a partir daqui em vez de recriar os mapas — foi a recriação
// no portal que fez o laranja de "Alto" divergir (#e8590c cravado) do token
// semântico --sev-high. Regra do design system: ZERO hex hardcoded, só tokens.
//
// pt-BR hardcoded é DELIBERADO nestas telas (como os vizinhos SEV_LABEL/
// STATUS_LABEL e o fmtDate do portal). Não puxar next-intl aqui: além de
// quebrar a pureza/uso server-safe, fugiria do padrão já estabelecido.

import type { Tone } from "@/app/admin/_ui";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type FindingStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "published"
  | "dismissed";

/** Ordem canônica de severidade (pior → melhor). */
export const SEV_ORDER = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const satisfies readonly Severity[];

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
  high: "bg-sev-high",
  medium: "bg-warning",
  low: "bg-primary",
  info: "bg-muted-foreground",
};
export const SEV_PILL: Record<Severity, string> = {
  critical: "text-destructive bg-destructive/10 border-destructive/25",
  high: "text-sev-high bg-sev-high/10 border-sev-high/25",
  medium: "text-warning bg-warning/10 border-warning/25",
  low: "text-primary bg-primary/10 border-primary/25",
  info: "text-muted-foreground bg-muted border-border",
};

// Glossário curto (pt-BR) — alimenta tooltips opt-in nos badges (Onda 5).
// Uma frase por nível/estado; linguagem que o cliente entende, não só o SOC.
export const SEV_GLOSSARY: Record<Severity, string> = {
  critical:
    "Crítico: exploração trivial e impacto severo (ex.: execução remota, acesso total). Corrigir imediatamente.",
  high: "Alto: explorável com impacto relevante a dados ou acesso. Prioridade alta de correção.",
  medium:
    "Médio: exige condições específicas ou tem impacto moderado. Corrigir no ciclo planejado.",
  low: "Baixo: impacto limitado ou difícil de explorar. Tratar quando conveniente.",
  info: "Informativo: sem risco direto; observação de boas práticas ou endurecimento.",
};
export const STATUS_GLOSSARY: Record<FindingStatus, string> = {
  draft: "Rascunho: em elaboração pelo analista; ainda não enviado para revisão.",
  in_review: "Em revisão: aguardando validação de um revisor antes de aprovar.",
  approved: "Aprovado: validado internamente; pronto para publicar ao cliente.",
  published: "Publicado: visível ao cliente no portal.",
  dismissed:
    "Descartado: rejeitado (falso-positivo ou fora de escopo); não entra no relatório.",
};

/**
 * Normaliza uma severidade vinda como string crua (ex.: payload do portal, que
 * tipa `severity: string`) para o union. Desconhecida → "info", que renderiza
 * exatamente o mesmo visual que os antigos fallbacks do portal
 * (`bg-muted-foreground` / `text-muted-foreground bg-muted border-border`).
 */
export function asSeverity(s: string): Severity {
  return (SEV_ORDER as readonly string[]).includes(s) ? (s as Severity) : "info";
}

/**
 * Rótulo de severidade a partir de string crua; valor desconhecido cai no
 * próprio texto cru (honesto — não rotula um desconhecido como "Info").
 */
export function sevLabel(s: string): string {
  return s in SEV_LABEL ? SEV_LABEL[s as Severity] : s;
}
