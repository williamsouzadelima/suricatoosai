import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, locales, type Locale } from "./config";

function fromAcceptLanguage(header: string | null): Locale {
  if (!header) return defaultLocale;
  const lower = header.toLowerCase();
  if (lower.includes("pt")) return "pt-BR";
  if (lower.startsWith("es") || lower.includes(",es")) return "es";
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale = isLocale(cookieLocale)
    ? cookieLocale
    : fromAcceptLanguage(headerStore.get("accept-language"));
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
