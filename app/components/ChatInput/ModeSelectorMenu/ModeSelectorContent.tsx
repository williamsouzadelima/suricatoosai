"use client";

import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { MessageSquare, Infinity } from "lucide-react";
import type { ChatMode } from "@/types/chat";
import { ModeOptionItem } from "./ModeOptionItem";
import { useTranslations } from "next-intl";

export interface ModeSelectorContentProps {
  setChatMode: (mode: ChatMode) => void;
  onAgentModeClick: () => void;
}

export function ModeSelectorContent({
  setChatMode,
  onAgentModeClick,
}: ModeSelectorContentProps) {
  const t = useTranslations("chatMode");
  return (
    <DropdownMenuContent align="start" className="w-54">
      <ModeOptionItem
        icon={MessageSquare}
        title={t("ask")}
        description={t("askDescription")}
        onClick={() => setChatMode("ask")}
        data-testid="mode-ask"
      />
      <ModeOptionItem
        icon={Infinity}
        title={t("agent")}
        description={t("agentDescription")}
        onClick={onAgentModeClick}
        data-testid="mode-agent"
      />
    </DropdownMenuContent>
  );
}
