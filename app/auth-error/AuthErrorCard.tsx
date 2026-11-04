"use client";

import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { SuricatoosAISVG } from "@/components/icons/suricatoos-ai-svg";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AutoRetryButton } from "./auto-retry-button";
import type { AuthErrorKey } from "./auth-error-info";

export function AuthErrorCard({
  errorKey,
  code,
  autoRetry,
}: {
  errorKey: AuthErrorKey;
  code: string | null;
  autoRetry: boolean;
}) {
  const t = useTranslations("authError");

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
      <SuricatoosAISVG scale={0.16} />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-xl">{t(`${errorKey}.title`)}</CardTitle>
          <CardDescription className="mt-2">
            {t(`${errorKey}.description`)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {code && (
            <p className="text-center text-xs text-muted-foreground">
              {t("codeLabel", { code })}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-3 sm:flex-row w-full">
          {autoRetry ? (
            <AutoRetryButton loginUrl="/login" />
          ) : (
            <Button asChild className="flex-1 min-w-0">
              <Link href="/login">
                <RefreshCw className="h-4 w-4" />
                {t("tryAgain")}
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" className="flex-1 min-w-0">
            <Link href="/">
              <Home className="h-4 w-4" />
              {t("goHome")}
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
