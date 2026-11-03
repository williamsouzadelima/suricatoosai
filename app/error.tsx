"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { SuricatoosAISVG } from "@/components/icons/suricatoos-ai-svg";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPages");

  useEffect(() => {
    // Mantém o erro no console do cliente para diagnóstico; a trilha de
    // verdade fica no PostHog/servidor.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <SuricatoosAISVG scale={0.2} />
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold">{t("errorTitle")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("errorDescription")}
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground/70">
            ID: {error.digest}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => reset()}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t("tryAgain")}
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center justify-center rounded-md border border-border px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
