// Status de engajamento — rótulo pt-BR + tom, fonte única. PURO (sem
// "use client"/convex), no padrão de ./severity. Os valores são EXATAMENTE os
// do painel do operador (app/engagements/EngagementsPanel.tsx:292-305) para que
// o portal do cliente case com o operador sem mudar o que o operador mostra.
// NOTA: o operador ainda usa o mapa local dele; migrá-lo para este módulo é
// follow-up (não tocar o EngagementsPanel já verificado nesta onda).
import type { Tone } from "@/app/admin/_ui";

export const ENGAGEMENT_STATUS_TONE: Record<string, Tone> = {
  planned: "neutral",
  active: "success",
  review: "warning",
  reporting: "primary",
  closed: "neutral",
};

export const ENGAGEMENT_STATUS_LABEL: Record<string, string> = {
  planned: "Planejado",
  active: "Ativo",
  review: "Em revisão",
  reporting: "Relatório",
  closed: "Fechado",
};

/** Tom do badge de status; desconhecido → neutro. */
export function engagementStatusTone(status: string): Tone {
  return ENGAGEMENT_STATUS_TONE[status] ?? "neutral";
}

/** Rótulo pt-BR do status; desconhecido → o próprio valor cru (honesto). */
export function engagementStatusLabel(status: string): string {
  return ENGAGEMENT_STATUS_LABEL[status] ?? status;
}
