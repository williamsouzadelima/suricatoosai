/**
 * Tokens de marca do relatório — espelham app/globals.css (paleta Suricatoos)
 * para dar identidade coesa com a plataforma (melhor que o tema stock do Office
 * dos modelos de referência). Hex SEM '#' para consumo direto pelo renderer
 * Python (RGBColor.from_string / reportlab) via JSON.
 */
import type { Severity } from "./report-model";

export const REPORT_THEME = {
  primary: "2456E6",
  brandCoral: "FF7678",
  ink: "0E1B2E",
  muted: "5B6B84",
  surface: "FFFFFF",
  surfaceAlt: "F4F7FC",
  border: "E2E8F5",
  success: "12996B",
  warning: "C9820B",
  destructive: "DA2C3C",
  chart: ["2456E6", "3F6EF0", "6F9BF5", "12996B", "C9820B"],
  fonts: { display: "Archivo", body: "Geist", mono: "Geist Mono" },
} as const;

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "DA2C3C",
  high: "E8590C",
  medium: "C9820B",
  low: "2456E6",
  info: "5B6B84",
};
