/**
 * Exportação CSV client-side (para os botões "Exportar CSV" do /admin).
 * Sem dependências; escapa aspas/vírgulas/quebras e adiciona BOM p/ o Excel
 * abrir UTF-8 corretamente.
 */

export interface CsvColumn<T> {
  key: keyof T & string;
  label: string;
}

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  columns: CsvColumn<T>[],
): string {
  const header = columns.map((c) => escapeCell(c.label)).join(",");
  const body = rows.map((r) =>
    columns.map((c) => escapeCell(r[c.key])).join(","),
  );
  return [header, ...body].join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  try {
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* ambientes sem download (ex.: webview) — ignora */
  }
}

/** Nome com data: prefixo_2026-09-07.csv */
export function csvName(prefix: string): string {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
}
