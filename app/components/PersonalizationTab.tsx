"use client";

import { ChevronRight } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { SubscriptionTier } from "@/types";

interface PersonalizationTabProps {
  onCustomInstructions: () => void;
  onManageNotes: () => void;
  subscription?: SubscriptionTier;
}

const PersonalizationTab = ({
  onCustomInstructions,
  onManageNotes,
  subscription,
}: PersonalizationTabProps) => {
  const t = useTranslations("settingsAgents");
  const userCustomization = useQuery(
    api.userCustomization.getUserCustomization,
    {},
  );
  const saveCustomization = useMutation(
    api.userCustomization.saveUserCustomization,
  );

  return (
    <div className="space-y-6">
      {/* Personalization Section */}
      <div>
        <div className="space-y-4">
          <div
            className="flex items-center justify-between py-3 border-b cursor-pointer hover:bg-muted/50 transition-colors rounded-md px-2 -mx-2"
            onClick={onCustomInstructions}
          >
            <div>
              <div className="font-medium">
                {t("personalization.customInstructions")}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {t("personalization.configure")}
              <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Notes Section */}
      {subscription && (
        <div>
          <h3 className="text-lg font-medium mb-4 pb-2 border-b">
            {t("personalization.notes")}
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between py-3 border-b">
              <div>
                <div className="font-medium">
                  {t("personalization.enableNotes")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t("personalization.enableNotesDesc")}
                </div>
              </div>
              <Switch
                checked={userCustomization?.include_notes ?? true}
                onCheckedChange={async (checked) => {
                  try {
                    await saveCustomization({
                      include_notes: checked,
                    });
                  } catch (error) {
                    console.error("Failed to save customization:", error);
                    const errorMessage =
                      error instanceof ConvexError
                        ? (error.data as { message?: string })?.message ||
                          error.message ||
                          t("personalization.failedSaveCustomization")
                        : error instanceof Error
                          ? error.message
                          : t("personalization.failedSaveCustomization");
                    toast.error(errorMessage);
                  }
                }}
                aria-label={t("personalization.toggleNotes")}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="font-medium">
                  {t("personalization.manageNotes")}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={onManageNotes}>
                {t("personalization.manage")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { PersonalizationTab };
