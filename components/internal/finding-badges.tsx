"use client";

// Badges de achado com glossário opcional (Onda 5). `hint` liga um tooltip com
// a definição pt-BR do termo — use SÓ onde agrega (cabeçalho/detalhe, legenda),
// NUNCA em cada linha de tabela/board: o <Tooltip> do design system embrulha um
// TooltipProvider por uso, então um por linha seria desperdício e ruído visual.
// Os dados (mapas + glossário) vivem em ./severity (módulo puro).

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusBadge } from "@/app/admin/_ui";
import {
  type Severity,
  type FindingStatus,
  asSeverity,
  sevLabel,
  SEV_PILL,
  SEV_GLOSSARY,
  STATUS_TONE,
  STATUS_LABEL,
  STATUS_GLOSSARY,
} from "./severity";

function HintWrap({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-[260px] font-normal text-left">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Pílula de severidade — fonte única visual. Aceita severidade crua (string do
 * portal) via asSeverity/sevLabel. `hint` mostra o glossário num tooltip.
 */
export function SeverityBadge({
  severity,
  hint = false,
  className,
}: {
  severity: string;
  hint?: boolean;
  className?: string;
}) {
  const sev = asSeverity(severity);
  const pill = (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        SEV_PILL[sev],
        hint && "cursor-help",
        className,
      )}
    >
      {sevLabel(severity)}
    </span>
  );
  return hint ? <HintWrap text={SEV_GLOSSARY[sev]}>{pill}</HintWrap> : pill;
}

/**
 * Estado do achado — reusa o StatusBadge do design system (visual idêntico).
 * `hint` mostra o glossário. O trigger é um <span> real (o StatusBadge não
 * encaminha ref), então o asChild do Radix ancora corretamente.
 */
export function FindingStatusBadge({
  status,
  hint = false,
}: {
  status: FindingStatus;
  hint?: boolean;
}) {
  const badge = (
    <StatusBadge tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} />
  );
  return hint ? (
    <HintWrap text={STATUS_GLOSSARY[status]}>
      <span className="inline-flex cursor-help">{badge}</span>
    </HintWrap>
  ) : (
    badge
  );
}
