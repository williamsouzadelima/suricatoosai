"use client";

import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MessageSquare, Infinity, ChevronDown } from "lucide-react";
import type { ChatMode } from "@/types/chat";

const FREE_MODE_VARIANT_CLASSES: Record<ChatMode, string> = {
  ask: "bg-muted hover:bg-muted/50",
  agent:
    "bg-destructive/10 text-destructive hover:bg-destructive/20",
};

const PAID_MODE_VARIANT_CLASSES: Record<ChatMode, string> = {
  ask: "bg-success/10 text-success hover:bg-success/20",
  agent: "bg-muted text-foreground hover:bg-muted/50",
};

const baseClasses =
  "h-7 px-2 text-xs font-medium rounded-md focus-visible:ring-1 shrink-0";

export interface ModeSelectorTriggerProps {
  chatMode: ChatMode;
  isPaid: boolean;
}

export function ModeSelectorTrigger({
  chatMode,
  isPaid,
}: ModeSelectorTriggerProps) {
  const modeVariantClasses = isPaid
    ? PAID_MODE_VARIANT_CLASSES
    : FREE_MODE_VARIANT_CLASSES;

  return (
    <DropdownMenuTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        data-testid="mode-selector"
        className={`${baseClasses} ${modeVariantClasses[chatMode]}`}
      >
        {chatMode === "agent" ? (
          <>
            <Infinity className="w-3 h-3 md:mr-1" />
            <span className="hidden md:inline">Agent</span>
          </>
        ) : (
          <>
            <MessageSquare className="w-3 h-3 md:mr-1" />
            <span className="hidden md:inline">Ask</span>
          </>
        )}
        <ChevronDown className="w-3 h-3 ml-1" />
      </Button>
    </DropdownMenuTrigger>
  );
}
