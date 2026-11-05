"use client";

import { Authenticated, Unauthenticated } from "convex/react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import Header from "@/app/components/Header";
import { SuricatoosAISVG } from "@/components/icons/suricatoos-ai-svg";
import { DownloadSection, useDetectedPlatform } from "./DownloadSection";
import { downloadLinks } from "./constants";
import { AppleIcon, WindowsIcon, LinuxIcon } from "./icons";

function AuthenticatedHeader() {
  const t = useTranslations("header");
  return (
    <header className="w-full px-6 max-sm:px-4 flex-shrink-0">
      <div className="py-[10px] flex gap-10 items-center justify-between">
        <div className="flex items-center gap-2">
          <SuricatoosAISVG scale={0.18} />
        </div>
        <Button
          asChild
          variant="ghost"
          size="default"
          className="rounded-[10px]"
        >
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            {t("backToTask")}
          </Link>
        </Button>
      </div>
    </header>
  );
}

function DownloadContent() {
  const detected = useDetectedPlatform();
  const isMobile =
    detected?.platform === "ios" || detected?.platform === "android";
  const t = useTranslations("downloadPage");

  return (
    <div className="px-4 py-8 pb-16 md:px-0">
      <div className="container mx-auto max-w-3xl space-y-8">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold text-card-foreground">
            {isMobile ? t("titleInstall") : t("titleDownload")}
          </h1>
          <p className="text-lg text-muted-foreground">
            {isMobile ? t("subtitleMobile") : t("subtitleDesktop")}
          </p>
        </div>

        <DownloadSection />

        {!isMobile && (
          <div className="rounded-md border bg-card p-6 shadow-lg">
            <h2 className="mb-4 text-xl font-semibold text-card-foreground">
              {t("desktopHeading")}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <DownloadCard
                title="macOS"
                subtitle={t("macosSubtitle")}
                href={downloadLinks.macos}
                icon={<AppleIcon />}
              />
              <DownloadCard
                title="Windows"
                subtitle={t("windowsSubtitle")}
                href={downloadLinks.windows}
                icon={<WindowsIcon />}
              />
              <DownloadCard
                title="Linux"
                subtitle={t("debX64")}
                href={downloadLinks.linuxDeb}
                icon={<LinuxIcon />}
              />
              <DownloadCard
                title="Linux"
                subtitle={t("debArm64")}
                href={downloadLinks.linuxArm64Deb}
                icon={<LinuxIcon />}
              />
              <DownloadCard
                title="Linux"
                subtitle={t("appImageX64")}
                href={downloadLinks.linuxAppImage}
                icon={<LinuxIcon />}
              />
              <DownloadCard
                title="Linux"
                subtitle={t("appImageArm64")}
                href={downloadLinks.linuxArm64AppImage}
                icon={<LinuxIcon />}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DownloadPageContent() {
  return (
    <div className="min-h-screen bg-background">
      <Authenticated>
        <AuthenticatedHeader />
        <DownloadContent />
      </Authenticated>
      <Unauthenticated>
        <Header hideDownload />
        <DownloadContent />
      </Unauthenticated>
    </div>
  );
}

function DownloadCard({
  title,
  subtitle,
  href,
  icon,
}: {
  title: string;
  subtitle: string;
  href: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-md border bg-background p-4 transition-colors hover:bg-accent"
    >
      <div className="text-muted-foreground">{icon}</div>
      <div>
        <div className="font-medium text-card-foreground">{title}</div>
        <div className="text-sm text-muted-foreground">{subtitle}</div>
      </div>
    </a>
  );
}
