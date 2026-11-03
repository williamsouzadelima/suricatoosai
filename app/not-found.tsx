"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { SuricatoosAISVG } from "@/components/icons/suricatoos-ai-svg";

export default function NotFound() {
  const t = useTranslations("errorPages");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center text-foreground">
      <SuricatoosAISVG scale={0.2} />
      <p className="font-display text-7xl font-extrabold leading-none tracking-tight text-muted-foreground">
        404
      </p>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-bold">
          {t("notFoundTitle")}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("notFoundDescription")}
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t("backHome")}
      </Link>
    </main>
  );
}
