export const locales = ["en", "pt-BR", "es"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export const localeMeta: Record<Locale, { label: string; flag: string }> = {
  en: { label: "English", flag: "🇺🇸" },
  "pt-BR": { label: "Português", flag: "🇧🇷" },
  es: { label: "Español", flag: "🇪🇸" },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (locales as readonly string[]).includes(v);
}

/**
 * Persist the chosen locale in the NEXT_LOCALE cookie (read server-side by
 * i18n/request.ts). Kept as a module-level helper so the assignment lives
 * outside component render — mirrors lib/utils/pro-max-notice-cookie.ts.
 */
export function setLocaleCookie(locale: Locale): void {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; samesite=lax`;
}
