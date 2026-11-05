"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useIsStandalone } from "@/hooks/use-is-standalone";
import { downloadLinks } from "./constants";
import {
  AppleIcon,
  WindowsIcon,
  LinuxIcon,
  AndroidIcon,
  DeviceIcon,
  DownloadIcon,
} from "./icons";

type Platform = "macos" | "windows" | "linux" | "ios" | "android" | "unknown";
type LinuxArch = "x64" | "arm64";

export interface DetectedPlatform {
  platform: Platform;
  linuxArch?: LinuxArch;
  displayName: string;
  downloadUrl: string;
}

export function detectPlatform(): DetectedPlatform {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform?.toLowerCase() || "";

  const isIpadOS =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  if (/iphone|ipad|ipod/.test(userAgent) || isIpadOS) {
    return {
      platform: "ios",
      displayName: "iOS",
      downloadUrl: "",
    };
  }

  if (/android/.test(userAgent)) {
    return {
      platform: "android",
      displayName: "Android",
      downloadUrl: "",
    };
  }

  if (
    userAgent.includes("mac") ||
    platform.includes("mac") ||
    userAgent.includes("darwin")
  ) {
    return {
      platform: "macos",
      displayName: "macOS",
      downloadUrl: downloadLinks.macos,
    };
  }

  if (userAgent.includes("win") || platform.includes("win")) {
    return {
      platform: "windows",
      displayName: "Windows",
      downloadUrl: downloadLinks.windows,
    };
  }

  if (
    userAgent.includes("linux") ||
    platform.includes("linux") ||
    userAgent.includes("x11")
  ) {
    const isArm =
      userAgent.includes("aarch64") ||
      userAgent.includes("arm64") ||
      platform.includes("aarch64") ||
      platform.includes("arm");

    if (isArm) {
      return {
        platform: "linux",
        linuxArch: "arm64",
        displayName: "Linux (ARM64)",
        downloadUrl: downloadLinks.linuxArm64Deb,
      };
    }

    return {
      platform: "linux",
      linuxArch: "x64",
      displayName: "Linux",
      downloadUrl: downloadLinks.linuxDeb,
    };
  }

  return {
    platform: "unknown",
    displayName: "your platform",
    downloadUrl: downloadLinks.macos,
  };
}

const serverSnapshot: DetectedPlatform | null = null;
let clientSnapshot: DetectedPlatform | null = null;

function getClientSnapshot(): DetectedPlatform {
  if (!clientSnapshot) {
    clientSnapshot = detectPlatform();
  }
  return clientSnapshot;
}

function getServerSnapshot(): DetectedPlatform | null {
  return serverSnapshot;
}

function subscribe() {
  return () => {};
}

export function useDetectedPlatform(): DetectedPlatform | null {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

export function DownloadSection() {
  const detected = useDetectedPlatform();
  const t = useTranslations("downloadPage");

  if (!detected) {
    return (
      <div className="rounded-md border bg-card p-8 text-center shadow-lg">
        <div className="h-20 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (detected.platform === "ios" || detected.platform === "android") {
    return <MobileInstallCard detected={detected} />;
  }

  return (
    <div className="rounded-md border bg-card p-8 text-center shadow-lg">
      <div className="mb-6">
        <PlatformIcon platform={detected.platform} />
      </div>

      <Button asChild size="lg" className="mb-4 text-lg">
        <a href={detected.downloadUrl}>
          <DownloadIcon />
          {t("detectedCta", { platform: detected.displayName })}
        </a>
      </Button>

      {detected.platform === "unknown" && (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("cantDetect")}
        </p>
      )}
    </div>
  );
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function MobileInstallCard({ detected }: { detected: DetectedPlatform }) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const isStandalone = useIsStandalone();
  const t = useTranslations("downloadPage");

  useEffect(() => {
    if (detected.platform !== "android") return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [detected.platform]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
    } catch {
      // Prompt already shown or blocked by the browser — fall back to manual steps.
    } finally {
      setDeferredPrompt(null);
    }
  };

  if (isStandalone) {
    return (
      <div className="rounded-md border bg-card p-8 text-center shadow-lg">
        <MobilePlatformIcon platform={detected.platform} />
        <h2 className="mt-4 text-2xl font-semibold text-card-foreground">
          {t("installed")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("installedBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card p-8 shadow-lg">
      <div className="mb-6 text-center">
        <MobilePlatformIcon platform={detected.platform} />
        <h2 className="mt-4 text-2xl font-semibold text-card-foreground">
          {t("mobileHeading")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("mobileBody", { platform: detected.displayName })}
        </p>
      </div>

      {installed && (
        <div className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 p-4 text-center text-sm text-green-600 dark:text-green-400">
          {t("installedBanner")}
        </div>
      )}

      {!installed && deferredPrompt && (
        <>
          <Button
            size="lg"
            className="mb-4 w-full text-lg"
            onClick={handleInstallClick}
          >
            <DownloadIcon />
            {t("installCta")}
          </Button>
          <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>{t("orManually")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      {!installed && <InstallInstructions platform={detected.platform} />}
    </div>
  );
}

function InstallInstructions({ platform }: { platform: Platform }) {
  const t = useTranslations("downloadPage");
  const b = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const steps =
    platform === "ios"
      ? [
          t.rich("iosStep1", { b }),
          t.rich("iosStep2", { b }),
          t.rich("iosStep3", { b }),
        ]
      : [
          t.rich("androidStep1", { b }),
          t.rich("androidStep2", { b }),
          t.rich("androidStep3", { b }),
        ];
  return <StepsList steps={steps} />;
}

function StepsList({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3 text-sm text-card-foreground">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {i + 1}
          </span>
          <span className="pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}

function PlatformIcon({ platform }: { platform: Platform }) {
  const className = "mx-auto h-16 w-16 text-muted-foreground";

  switch (platform) {
    case "macos":
      return <AppleIcon className={className} />;
    case "windows":
      return <WindowsIcon className={className} />;
    case "linux":
      return <LinuxIcon className={className} />;
    default:
      return <DeviceIcon className={className} />;
  }
}

function MobilePlatformIcon({ platform }: { platform: Platform }) {
  const className = "mx-auto h-16 w-16 text-muted-foreground";

  switch (platform) {
    case "ios":
      return <AppleIcon className={className} />;
    case "android":
      return <AndroidIcon className={className} />;
    default:
      return <DeviceIcon className={className} />;
  }
}
