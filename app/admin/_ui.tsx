// Primitivos compartilhados do /admin. Fonte única de verdade visual — todo
// componente do painel deve montar a partir daqui em vez de refazer markup cru.
// Regra de ouro do design system: ZERO hex hardcoded, só tokens semânticos.
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type Tone =
  | "primary"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "neutral"
  | "brand";

// Strings COMPLETAS por tom — o Tailwind só gera classes que existem literais
// no código (nada de `bg-${tone}/10` interpolado).
const TONE_SOFT: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-primary/10 text-primary",
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-brand/10 text-brand",
};

const TONE_BADGE: Record<Tone, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-primary/10 text-primary",
  neutral: "border-border bg-muted text-muted-foreground",
  brand: "border-brand/30 bg-brand/10 text-brand",
};

const TONE_DOT: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-primary",
  neutral: "bg-muted-foreground",
  brand: "bg-brand",
};

/** Data/hora única do painel (pt-BR). */
export function formatDateTime(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Abreviação numérica compacta (12.3k / 1.2M). */
export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Duração humana compacta a partir de ms. <1s / 45s / 3min 20s / 2h 5min / 1d 3h. */
export function fmtDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 1) return "<1s";
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) {
    const s = totalSec % 60;
    return s ? `${totalMin}min ${s}s` : `${totalMin}min`;
  }
  const totalHr = Math.floor(totalMin / 60);
  if (totalHr < 24) {
    const m = totalMin % 60;
    return m ? `${totalHr}h ${m}min` : `${totalHr}h`;
  }
  const d = Math.floor(totalHr / 24);
  const h = totalHr % 24;
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** Pílula de contagem ao lado de um título. */
export function CountPill({ n }: { n: number }) {
  return (
    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
      {n}
    </span>
  );
}

/** Cabeçalho de seção/card canônico (mata os micro-caps cinza). */
export function SectionHeader({
  icon: Icon,
  title,
  description,
  count,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="flex items-center font-display text-base font-semibold text-foreground">
            {title}
            {count != null && <CountPill n={count} />}
          </h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Badge de status — fonte única do pill border-x/30 bg-x/10 text-x. */
export function StatusBadge({
  tone,
  label,
  dot = true,
}: {
  tone: Tone;
  label: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_BADGE[tone],
      )}
    >
      {dot && (
        <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
      )}
      {label}
    </span>
  );
}

/** Aviso inline padronizado (substitui emojis ⚠️ e callouts ad-hoc). */
export function Callout({
  tone = "warning",
  icon: Icon,
  children,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-xs leading-relaxed",
        TONE_BADGE[tone],
      )}
    >
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

/** Tile de KPI — número-herói + chip de ícone tintado. Um só p/ todo o painel. */
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
  loading,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: LucideIcon;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              TONE_SOFT[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-3 font-display text-3xl font-bold leading-none tracking-tight tabular-nums">
          {loading ? <Skeleton className="h-8 w-16" /> : value}
        </div>
        {/* 2ª linha sempre reservada p/ os tiles alinharem */}
        <div className="mt-1.5 min-h-4 text-xs text-muted-foreground">
          {sub}
        </div>
      </CardContent>
    </Card>
  );
}

/** Estado vazio estruturado. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Barra semanal leve (sem lib). Zeros viram coluna-fantasma → lê como gráfico. */
export function MiniBarChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((a, d) => a + d.count, 0);
  const peak = Math.max(0, ...data.map((d) => d.count));

  if (total === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Nenhum novo usuário no período.
      </div>
    );
  }

  return (
    <div>
      <div className="flex h-32 items-stretch gap-1.5 border-b border-border pb-px">
        {data.map((d, i) => (
          <div key={i} className="group flex flex-1 justify-center">
            <div className="relative h-full w-full max-w-[28px] rounded-sm bg-muted/40">
              <div
                className="absolute bottom-0 left-0 w-full rounded-sm bg-gradient-to-t from-primary to-chart-1"
                style={{
                  height:
                    d.count > 0
                      ? `${Math.max(6, (d.count / max) * 100)}%`
                      : "0%",
                }}
              />
              {d.count > 0 && (
                <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-md bg-popover px-1.5 py-0.5 text-xs font-medium tabular-nums text-popover-foreground opacity-0 shadow transition-opacity group-hover:opacity-100">
                  {d.count}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span className="tabular-nums">
          {total} novos · pico {peak}/sem
        </span>
      </div>
    </div>
  );
}
