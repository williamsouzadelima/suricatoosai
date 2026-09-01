"use client";

import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useTranslations } from "next-intl";

const GREETING_KEYS = [
  "hack",
  "idea",
  "testing",
  "start",
  "target",
  "scope",
  "exploiting",
  "vulns",
  "mind",
] as const;

export const HackingSuggestions = () => {
  const { user } = useAuth();
  const t = useTranslations("greetings");
  const name = user?.firstName || undefined;
  const [key] = useState(
    () => GREETING_KEYS[Math.floor(Math.random() * GREETING_KEYS.length)],
  );

  const text = name ? t(`${key}.named`, { name }) : t(`${key}.anon`);

  return (
    <div className="relative mb-4 flex flex-col items-center px-4 text-center md:mb-6">
      <h1 className="flex items-center gap-1 text-xl font-medium leading-none text-foreground sm:text-2xl md:gap-0 md:text-3xl">
        <span className="min-h-6 pt-0.5 tracking-tight sm:min-h-7 md:min-h-8 md:pt-0">
          {text}
        </span>
      </h1>
    </div>
  );
};
