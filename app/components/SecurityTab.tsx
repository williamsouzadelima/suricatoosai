"use client";

import React, { useCallback } from "react";
import { useAccessToken } from "@workos-inc/authkit-nextjs/components";
import { UserSecurity } from "@workos-inc/widgets/user-security";
import { WorkOsWidgets } from "@workos-inc/widgets/workos-widgets";
import { LogOut, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const SecurityTab = () => {
  const t = useTranslations("settings");
  const { getAccessToken } = useAccessToken();
  const getWidgetAccessToken = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error(t("security.unableToLoad"));
    }
    return token;
  }, [getAccessToken]);

  const handleLogout = async () => {
    try {
      const { clientLogout } = await import("@/lib/utils/logout");
      clientLogout();
    } catch {
      toast.error(t("security.failedLogout"));
    }
  };

  const handleLogoutAll = async () => {
    try {
      const response = await fetch("/api/logout-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(
          t("security.loggedOutDevices", { count: data.revokedSessions }),
        );
        const { clientLogout } = await import("@/lib/utils/logout");
        clientLogout();
      } else {
        const error = await response.json();
        toast.error(error.error || t("security.failedLogoutAll"));
      }
    } catch {
      toast.error(t("security.failedLogoutAll"));
    }
  };

  return (
    <div className="space-y-6">
      <div data-testid="workos-user-security">
        <WorkOsWidgets
          style={{ blockSize: "auto", minBlockSize: "auto" }}
          theme={{
            appearance: "dark",
            accentColor: "gray",
            grayColor: "slate",
            hasBackground: false,
            fontFamily: "var(--font-geist-sans)",
          }}
        >
          <UserSecurity authToken={getWidgetAccessToken} />
        </WorkOsWidgets>
      </div>

      <div
        data-testid="security-session-actions"
        className="overflow-hidden rounded-lg border bg-card text-card-foreground"
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b p-4">
          <div
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-md border bg-muted/50"
          >
            <Monitor className="size-4" />
          </div>
          <div className="min-w-0 text-sm font-semibold">
            {t("security.logoutDevice")}
          </div>
          <Button
            data-testid="logout-button-device"
            variant="outline"
            size="sm"
            onClick={handleLogout}
          >
            {t("security.logout")}
          </Button>
        </div>

        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 p-4">
          <div
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-md border bg-muted/50"
          >
            <LogOut className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {t("security.logoutAllDevices")}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {t("security.logoutAllDescription")}
            </div>
          </div>
          <Button
            data-testid="logout-button-all"
            variant="destructive"
            size="sm"
            onClick={handleLogoutAll}
            className="shrink-0 bg-red-600 text-white hover:bg-red-700"
          >
            {t("security.logoutAll")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export { SecurityTab };
