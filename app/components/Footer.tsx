"use client";

import React from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useTranslations } from "next-intl";

const Footer: React.FC = () => {
  const { user, loading } = useAuth();
  const t = useTranslations("footer");

  if (loading || user) {
    return null;
  }

  return (
    <div className="text-muted-foreground relative flex min-h-8 w-full items-center justify-center p-4 text-center text-xs md:px-[60px] flex-shrink-0">
      <span className="text-sm leading-none">
        {t("prefix")}
        <a
          href="/terms-of-service"
          target="_blank"
          className="text-foreground underline decoration-foreground"
          rel="noreferrer"
        >
          {t("terms")}
        </a>
        {t("and")}
        <a
          href="/privacy-policy"
          target="_blank"
          className="text-foreground underline decoration-foreground"
          rel="noreferrer"
        >
          {t("privacy")}
        </a>
        . <span className="text-muted-foreground">&middot;</span>{" "}
        <a
          href="/trust"
          target="_blank"
          className="text-foreground underline decoration-foreground"
          rel="noreferrer"
        >
          {t("trust")}
        </a>
      </span>
    </div>
  );
};

export default Footer;
