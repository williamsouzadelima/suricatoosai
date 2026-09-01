"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";

interface CustomizeHackerAIDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CustomizeHackerAIDialog = ({
  open,
  onOpenChange,
}: CustomizeHackerAIDialogProps) => {
  const t = useTranslations("settingsAgents");

  const predefinedTraits = t.raw("customize.predefinedTraits") as string[];

  const personalityOptions = [
    {
      value: "default",
      label: t("customize.personalityDefault"),
      description: "",
    },
    {
      value: "cynic",
      label: t("customize.personalityCynic"),
      description: t("customize.personalityCynicDesc"),
    },
    {
      value: "robot",
      label: t("customize.personalityRobot"),
      description: t("customize.personalityRobotDesc"),
    },
    {
      value: "listener",
      label: t("customize.personalityListener"),
      description: t("customize.personalityListenerDesc"),
    },
    {
      value: "nerd",
      label: t("customize.personalityNerd"),
      description: t("customize.personalityNerdDesc"),
    },
  ];

  const [nickname, setNickname] = useState("");
  const [occupation, setOccupation] = useState("");
  const [personality, setPersonality] = useState("default");
  const [traitsText, setTraitsText] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const MAX_CHAR_LIMIT = 1500;

  const isNicknameOverLimit = nickname.length > MAX_CHAR_LIMIT;
  const isOccupationOverLimit = occupation.length > MAX_CHAR_LIMIT;
  const isTraitsOverLimit = traitsText.length > MAX_CHAR_LIMIT;
  const isAdditionalInfoOverLimit = additionalInfo.length > MAX_CHAR_LIMIT;

  const saveCustomization = useMutation(
    api.userCustomization.saveUserCustomization,
  );
  const userCustomization = useQuery(
    api.userCustomization.getUserCustomization,
    open ? {} : "skip",
  );

  // Load existing customization data
  useEffect(() => {
    if (userCustomization) {
      setNickname(userCustomization.nickname || "");
      setOccupation(userCustomization.occupation || "");
      setPersonality(userCustomization.personality || "default");
      setTraitsText(userCustomization.traits || "");
      setAdditionalInfo(userCustomization.additional_info || "");
    }
  }, [userCustomization]);

  const handleAddTrait = (trait: string) => {
    if (trait) {
      const currentText = traitsText.trim();
      const newText = currentText ? `${currentText}, ${trait}` : trait;
      setTraitsText(newText);
    }
  };

  const handleSave = async () => {
    // Check for character limit violations
    if (
      isNicknameOverLimit ||
      isOccupationOverLimit ||
      isTraitsOverLimit ||
      isAdditionalInfoOverLimit
    ) {
      return; // Don't save if any field exceeds the limit
    }

    try {
      setIsSaving(true);

      await saveCustomization({
        nickname: nickname || undefined,
        occupation: occupation || undefined,
        personality: personality === "default" ? undefined : personality,
        traits: traitsText.trim() || undefined,
        additional_info: additionalInfo || undefined,
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save customization:", error);
      const errorMessage =
        error instanceof ConvexError
          ? (error.data as { message?: string })?.message ||
            error.message ||
            t("customize.failedSaveCustomization")
          : error instanceof Error
            ? error.message
            : t("customize.failedSaveCustomization");
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    // Reset form to original values
    if (userCustomization) {
      setNickname(userCustomization.nickname || "");
      setOccupation(userCustomization.occupation || "");
      setPersonality(userCustomization.personality || "default");
      setTraitsText(userCustomization.traits || "");
      setAdditionalInfo(userCustomization.additional_info || "");
    } else {
      // Reset to empty values if no existing customization
      setNickname("");
      setOccupation("");
      setPersonality("default");
      setTraitsText("");
      setAdditionalInfo("");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("customize.title")}</DialogTitle>
          <DialogDescription>{t("customize.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pb-3">
          <div className="space-y-5 pb-3">
            {/* Nickname */}
            <div className="flex flex-col gap-2 px-1">
              <Label htmlFor="nickname">{t("customize.nicknameLabel")}</Label>
              <TextareaAutosize
                id="nickname"
                placeholder={t("customize.nicknamePlaceholder")}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className={`flex w-full rounded-md border ${isNicknameOverLimit ? "border-red-500" : "border-input"} bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none`}
                maxRows={1}
              />
              {isNicknameOverLimit && (
                <div className="text-xs text-red-500 mt-1">
                  {t("customize.charCount", {
                    count: String(nickname.length),
                    limit: String(MAX_CHAR_LIMIT),
                  })}
                </div>
              )}
            </div>

            {/* Occupation */}
            <div className="flex flex-col gap-2 px-1">
              <Label htmlFor="occupation">
                {t("customize.occupationLabel")}
              </Label>
              <TextareaAutosize
                id="occupation"
                placeholder={t("customize.occupationPlaceholder")}
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
                className={`flex w-full rounded-md border ${isOccupationOverLimit ? "border-red-500" : "border-input"} bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none`}
                maxRows={1}
              />
              {isOccupationOverLimit && (
                <div className="text-xs text-red-500 mt-1">
                  {t("customize.charCount", {
                    count: String(occupation.length),
                    limit: String(MAX_CHAR_LIMIT),
                  })}
                </div>
              )}
            </div>

            {/* Personality */}
            <div className="flex flex-col gap-2 px-1">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <Label className="sm:flex-shrink-0">
                  {t("customize.personalityLabel")}
                </Label>
                <Select value={personality} onValueChange={setPersonality}>
                  <SelectTrigger className="w-full sm:w-auto">
                    <SelectValue placeholder={t("customize.selectPersonality")}>
                      {
                        personalityOptions.find(
                          (opt) => opt.value === personality,
                        )?.label
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {personalityOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="flex flex-col items-start py-3"
                      >
                        <div className="flex flex-col">
                          <div className="font-medium">{option.label}</div>
                          {option.value !== "default" && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {option.description}
                            </div>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Traits */}
            <div className="flex flex-col gap-2 px-1">
              <Label>{t("customize.traitsLabel")}</Label>

              <TextareaAutosize
                placeholder={t("customize.traitsPlaceholder")}
                value={traitsText}
                onChange={(e) => setTraitsText(e.target.value)}
                className={`flex w-full rounded-md border ${isTraitsOverLimit ? "border-red-500" : "border-input"} bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none`}
                minRows={2}
                maxRows={4}
              />
              {isTraitsOverLimit && (
                <div className="text-xs text-red-500 mt-1">
                  {t("customize.charCount", {
                    count: String(traitsText.length),
                    limit: String(MAX_CHAR_LIMIT),
                  })}
                </div>
              )}

              {/* Predefined traits */}
              <div className="flex flex-wrap gap-2 mt-2">
                {predefinedTraits.map((trait) => (
                  <button
                    key={trait}
                    type="button"
                    onClick={() => handleAddTrait(trait)}
                    className="inline-flex items-center gap-1 px-3 py-1 text-sm border rounded-full hover:bg-muted transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    {trait}
                  </button>
                ))}
              </div>
            </div>

            {/* Additional Info */}
            <div className="flex flex-col gap-3 px-1">
              <Label htmlFor="additional-info">
                {t("customize.additionalInfoLabel")}
              </Label>
              <TextareaAutosize
                id="additional-info"
                placeholder={t("customize.additionalInfoPlaceholder")}
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                className={`flex w-full rounded-md border ${isAdditionalInfoOverLimit ? "border-red-500" : "border-input"} bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none`}
                minRows={3}
                maxRows={6}
              />
              {isAdditionalInfoOverLimit && (
                <div className="text-xs text-red-500 mt-1">
                  {t("customize.charCount", {
                    count: String(additionalInfo.length),
                    limit: String(MAX_CHAR_LIMIT),
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={handleCancel} disabled={isSaving}>
            {t("customize.cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              isSaving ||
              isNicknameOverLimit ||
              isOccupationOverLimit ||
              isTraitsOverLimit ||
              isAdditionalInfoOverLimit
            }
          >
            {isSaving ? t("customize.saving") : t("customize.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
