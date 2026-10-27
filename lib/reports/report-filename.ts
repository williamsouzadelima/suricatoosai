/**
 * Nome do arquivo exportado dos relatórios: engajamento + público + versão +
 * timestamp da exportação (horário de Brasília). Fonte ÚNICA usada pelas rotas
 * de download no `Content-Disposition`; o portal lê o filename do header.
 *
 * Horário de Brasília = UTC-3 FIXO (o Brasil não observa horário de verão desde
 * 2019). Espelha packages/report-renderer/theme.py::brt_datetime — sem depender
 * de Intl/ICU, determinístico em qualquer runtime.
 */

const AUDIENCE_FILE_SLUG: Record<string, string> = {
  technical: "Tecnico",
  executive: "Executivo",
  commercial: "Comercial",
  action_plan: "PlanoDeAcao",
};

/** Remove acentos e tudo que não é [A-Za-z0-9], colapsa `_`, limita a 48 chars. */
export function sanitizeEngagementForFilename(name: string): string {
  const base = (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const trimmed = base.slice(0, 48).replace(/_+$/g, "");
  return trimmed || "Relatorio";
}

/** `YYYY-MM-DD_HHmm` no horário de Brasília (UTC-3). '' se o instante for inválido. */
export function brtFilenameStamp(generatedAt: number): string {
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) return "";
  // Desloca p/ BRT e lê os campos em UTC (equivalente a um relógio UTC-3).
  const d = new Date(generatedAt - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `_${p(d.getUTCHours())}${p(d.getUTCMinutes())}`
  );
}

/** Nome do arquivo: `Engajamento_Publico_vN_YYYY-MM-DD_HHmm.ext`. */
export function buildReportFilename(args: {
  engagementName: string;
  audience: string;
  version: number;
  format: string;
  generatedAt: number;
}): string {
  const eng = sanitizeEngagementForFilename(args.engagementName);
  const aud = AUDIENCE_FILE_SLUG[args.audience] ?? args.audience;
  const stamp = brtFilenameStamp(args.generatedAt);
  const parts = [eng, aud, `v${args.version}`];
  if (stamp) parts.push(stamp);
  return `${parts.join("_")}.${args.format}`;
}

/**
 * Extrai o filename de um header `Content-Disposition` (o portal usa o servidor
 * como fonte única da verdade). Retorna null se ausente/não parseável — o
 * chamador decide o fallback (e deve logar, pois o header deveria existir).
 */
export function parseContentDispositionFilename(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")) || null;
    } catch {
      /* cai para o filename simples abaixo */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || null;
}
