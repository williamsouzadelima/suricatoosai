"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { X, Info, TriangleAlert, CheckCircle2 } from "lucide-react";
import { api } from "@/convex/_generated/api";

const DISMISS_KEY = "suricatoos:dismissed-announcements";

type Level = "info" | "warning" | "success";

const STYLES: Record<Level, { wrap: string; icon: React.ReactNode }> = {
  info: {
    wrap: "bg-primary/10 text-foreground border-primary/20",
    icon: <Info className="h-4 w-4 text-primary" />,
  },
  warning: {
    wrap: "bg-amber-500/10 text-foreground border-amber-500/25",
    icon: <TriangleAlert className="h-4 w-4 text-amber-500" />,
  },
  success: {
    wrap: "bg-emerald-500/10 text-foreground border-emerald-500/25",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  },
};

function readDismissed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function AnnouncementBanner() {
  const active = useQuery(api.announcements.getActive, {});
  const [dismissed, setDismissed] = useState<Record<string, number>>({});

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const current = useMemo(() => {
    if (!active || active.length === 0) return null;
    // Mostra o mais recente ainda não dispensado (dispensa é por versão:
    // editar o aviso muda updated_at e ele reaparece).
    return (
      active.find((a) => dismissed[a.id] !== a.updated_at) ?? null
    );
  }, [active, dismissed]);

  if (!current) return null;

  const style = STYLES[(current.level as Level) in STYLES ? (current.level as Level) : "info"];

  const dismiss = () => {
    const next = { ...readDismissed(), [current.id]: current.updated_at };
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setDismissed(next);
  };

  return (
    <div
      className={`shrink-0 border-b ${style.wrap}`}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-2 text-sm">
        <span className="shrink-0">{style.icon}</span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{current.title}</span>
          {current.body && (
            <span className="text-muted-foreground"> — {current.body}</span>
          )}
        </div>
        {current.cta_label && current.cta_url && (
          <a
            href={current.cta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs font-medium hover:bg-background"
          >
            {current.cta_label}
          </a>
        )}
        {current.dismissible && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dispensar aviso"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
