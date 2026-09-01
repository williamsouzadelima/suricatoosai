"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { useGlobalState } from "@/app/contexts/GlobalState";
import type { QueueBehavior } from "@/types/chat";
import { SandboxSelector } from "@/app/components/SandboxSelector";
import { AgentPermissionSelector } from "@/app/components/AgentPermissionSelector";

const AgentsTab = () => {
  const t = useTranslations("settingsAgents");
  const {
    queueBehavior,
    setQueueBehavior,
    subscription,
    sandboxPreference,
    setSandboxPreference,
  } = useGlobalState();

  const queueBehaviorOptions: Array<{
    value: QueueBehavior;
    label: string;
  }> = [
    {
      value: "queue",
      label: t("agents.queueAfterCurrent"),
    },
    {
      value: "stop-and-send",
      label: t("agents.stopAndSend"),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Execution Environment - Available to all users */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 border-b gap-3">
          <div className="flex-1">
            <div className="font-medium">{t("agents.defaultExecEnv")}</div>
            <div className="text-sm text-muted-foreground">
              {t("agents.defaultExecEnvDesc")}
            </div>
          </div>
          <div className="w-full sm:w-auto">
            <SandboxSelector
              value={sandboxPreference}
              onChange={setSandboxPreference}
              disabled={false}
              size="md"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 border-b gap-3">
          <div className="flex-1">
            <div className="font-medium">
              {t("agents.defaultAgentPermissions")}
            </div>
            <div className="text-sm text-muted-foreground">
              {t("agents.commandsAndFileEdits")}
            </div>
          </div>
          <div className="w-full sm:w-auto">
            <AgentPermissionSelector size="md" analyticsSurface="agents_tab" />
          </div>
        </div>
      </div>

      {/* Queue Messages - Only show for Pro/Ultra/Team users */}
      {subscription !== "free" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-3 border-b gap-3">
            <div className="flex-1">
              <div className="font-medium">{t("agents.queueMessages")}</div>
              <div className="text-sm text-muted-foreground">
                {t("agents.queueMessagesDesc")}
              </div>
            </div>
            <Select
              value={queueBehavior}
              onValueChange={(value) =>
                setQueueBehavior(value as QueueBehavior)
              }
            >
              <SelectTrigger className="w-full sm:w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {queueBehaviorOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
};

export { AgentsTab };
