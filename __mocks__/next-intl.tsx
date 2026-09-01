import React from "react";
import en from "@/messages/en.json";

type Dict = Record<string, unknown>;

function resolve(base: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (o, k) => (o && typeof o === "object" ? (o as Dict)[k] : undefined),
      base,
    );
}

function applyIcu(str: string, vals?: Record<string, unknown>): string {
  // {name, plural, =0 {..} one {..} other {..}}  (# -> count)
  let out = str.replace(
    /\{(\w+),\s*plural,\s*([\s\S]*?)\}\s*(?=$|[^{])/g,
    (_m, name: string, body: string) => {
      const n = Number(vals?.[name] ?? 0);
      const cases: Record<string, string> = {};
      body.replace(
        /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g,
        (_mm, sel: string, txt: string) => {
          cases[sel] = txt;
          return "";
        },
      );
      const chosen =
        cases["=" + n] ??
        (n === 1 ? cases.one : undefined) ??
        cases.other ??
        "";
      return chosen.replace(/#/g, String(n));
    },
  );
  // simple {var}
  out = out.replace(/\{(\w+)\}/g, (m, k: string) =>
    vals && k in vals ? String(vals[k]) : m,
  );
  return out;
}

function makeT(namespace?: string) {
  const base = namespace ? resolve(en, namespace) : en;
  const t = (key: string, vals?: Record<string, unknown>) => {
    const v = resolve(base, key);
    return typeof v === "string" ? applyIcu(v, vals) : key;
  };
  t.rich = (
    key: string,
    tags?: Record<string, (chunks: React.ReactNode) => React.ReactNode>,
  ): React.ReactNode => {
    const v = resolve(base, key);
    if (typeof v !== "string") return key;
    const parts: React.ReactNode[] = [];
    const re = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(v))) {
      if (m.index > last) parts.push(v.slice(last, m.index));
      const fn = tags?.[m[1]];
      parts.push(
        <React.Fragment key={i++}>{fn ? fn(m[2]) : m[2]}</React.Fragment>,
      );
      last = m.index + m[0].length;
    }
    if (last < v.length) parts.push(v.slice(last));
    return parts.length ? parts : v;
  };
  t.raw = (key: string) => resolve(base, key);
  t.markup = (key: string) => {
    const v = resolve(base, key);
    return typeof v === "string" ? v : key;
  };
  t.has = (key: string) => resolve(base, key) !== undefined;
  return t;
}

export function useTranslations(namespace?: string) {
  return makeT(namespace);
}
export function useLocale() {
  return "en";
}
export function useMessages() {
  return en;
}
export function useFormatter() {
  return {
    dateTime: (d: Date) => String(d),
    number: (n: number) => String(n),
    relativeTime: (d: Date) => String(d),
    list: (items: Iterable<string>) => Array.from(items).join(", "),
  };
}
export function useNow() {
  return new Date();
}
export function useTimeZone() {
  return "UTC";
}
export function NextIntlClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
export const IntlProvider = NextIntlClientProvider;
