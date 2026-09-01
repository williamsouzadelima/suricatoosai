import en from "@/messages/en.json";
import { useTranslations } from "./next-intl";

export async function getTranslations(namespace?: string) {
  return useTranslations(namespace);
}
export async function getLocale() {
  return "en";
}
export async function getMessages() {
  return en;
}
export async function getFormatter() {
  return {
    dateTime: (d: Date) => String(d),
    number: (n: number) => String(n),
  };
}
export async function getNow() {
  return new Date();
}
export async function getTimeZone() {
  return "UTC";
}
