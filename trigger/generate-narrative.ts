import { generateText, Output } from "ai";
import { z } from "zod";
import { myProvider, type ModelName } from "@/lib/ai/providers";
import type {
  EngagementNarrative,
  ReportFindingView,
} from "@/lib/reports/report-model";

/**
 * Compõe a NARRATIVA de ENGAJAMENTO ("Anatomia da Invasão") do relatório técnico:
 * organiza os achados REAIS em FASES (kill-chain) e escreve a prosa conectada que
 * conta a história da intrusão. Passo de IA — reusa o mesmo padrão de
 * trigger/extract-findings.ts (myProvider + generateText + Output.object + loop de
 * fallback multi-modelo). Chamado por trigger/report-generation.ts (só p/ técnico),
 * antes do buildReportModel (que é TS puro/síncrono).
 *
 * Honestidade: a prosa é editorial; os DADOS dos achados (cards) vêm do finding real.
 * O passo sanitiza os refs citados contra os achados fornecidos (anti-fabricação) e
 * é DEFENSIVO — qualquer falha retorna `null` e o relatório cai no formato plano.
 */

const NARRATIVE_MODEL_KEYS = [
  "model-grok-4.6",
  "model-deepseek-v4-pro",
  "model-glm-5.3",
] satisfies ModelName[];

// Teto de achados no prompt (orçamento de tokens; GRANADO ~60 cabe folgado).
const MAX_FINDINGS = 80;

const narrativeSchema = z.object({
  overview: z
    .string()
    .describe(
      "Parágrafo(s) de abertura (pt-BR) resumindo a intrusão de ponta a ponta.",
    ),
  phases: z
    .array(
      z.object({
        title: z
          .string()
          .describe(
            "Título curto da fase, ex.: 'Reconhecimento' ou 'Movimento Lateral: Active Directory'.",
          ),
        prose: z
          .string()
          .describe(
            "Prosa conectada (pt-BR, 2-5 parágrafos) contando esta fase e como ela levou à próxima.",
          ),
        findingRefs: z
          .array(z.string())
          .describe(
            "Refs (F-XX) dos achados desta fase, na ordem da história. Só refs que existem nos achados fornecidos.",
          ),
      }),
    )
    .describe("Fases da intrusão, em ordem cronológica (kill-chain)."),
});

function clip(s: string | undefined, n: number): string {
  const t = (s ?? "").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function buildPrompt(
  client: string,
  engagement: string,
  findings: ReportFindingView[],
): string {
  const lines = findings.map((f) => {
    const parts = [
      `[${f.ref}] (${f.severity}) ${f.title}`,
      `  Ativo: ${f.affectedAsset}`,
      f.weaknessClass
        ? `  Classe: ${f.weaknessClass}${f.cwe ? ` (${f.cwe})` : ""}`
        : "",
      f.description ? `  Descrição: ${clip(f.description, 600)}` : "",
      f.impact ? `  Impacto: ${clip(f.impact, 400)}` : "",
      f.narrative ? `  Narrativa do achado: ${clip(f.narrative, 800)}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  });
  return [
    `Você é um analista de segurança ofensiva sênior escrevendo a seção "Narrativa da Análise Técnica" (estilo "Anatomia da Invasão") de um relatório de pentest para o cliente "${client}" (engajamento "${engagement}"), em PORTUGUÊS DO BRASIL.`,
    "",
    "Abaixo estão TODOS os achados REAIS do engajamento, cada um com seu ref F-XX. Organize-os numa NARRATIVA por FASES de ataque (kill-chain), contando a história da intrusão do começo ao fim: reconhecimento → acesso inicial → exploração → movimento lateral → escalada de privilégios → impacto. Use nomes de fase que façam sentido para ESTE engajamento (podem ser específicos, ex.: 'Movimento Lateral: Active Directory').",
    "",
    "Para cada fase: um título curto; uma PROSA conectada (2-5 parágrafos) que conta o que aconteceu naquela fase e como ela levou à próxima; e a lista dos refs (F-XX) dos achados daquela fase, na ordem da história. Escreva também um 'overview' de abertura (1-2 parágrafos) resumindo a intrusão.",
    "",
    "REGRAS DE HONESTIDADE (críticas): use SOMENTE os achados fornecidos abaixo. NÃO invente achados, hosts, credenciais, CVEs, versões ou fatos que não estejam nos dados. Todo ref que você citar DEVE existir na lista. TODO achado deve aparecer em ALGUMA fase (não deixe nenhum de fora). A prosa costura o contexto e a cronologia (a história), mas NÃO fabrica dado técnico; se faltar detalhe, descreva em termos gerais em vez de inventar.",
    "",
    "ACHADOS:",
    lines.join("\n\n"),
  ].join("\n");
}

export async function generateEngagementNarrative(args: {
  clientName: string;
  engagementName: string;
  findings: ReportFindingView[];
}): Promise<EngagementNarrative | null> {
  const findings = args.findings.slice(0, MAX_FINDINGS);
  if (findings.length === 0) return null;

  const prompt = buildPrompt(args.clientName, args.engagementName, findings);
  const validRefs = new Set(findings.map((f) => f.ref));

  let lastErr: unknown;
  for (const key of NARRATIVE_MODEL_KEYS) {
    try {
      const r = await generateText({
        model: myProvider.languageModel(key),
        output: Output.object({ schema: narrativeSchema }),
        temperature: 0.3,
        maxOutputTokens: 16_000,
        maxRetries: 1,
        prompt,
      });
      const out = r.output;
      if (!out?.phases?.length) return null;
      // Sanitiza: só refs REAIS (anti-fabricação); descarta fases sem título/prosa.
      const phases = out.phases
        .map((p) => ({
          title: (p.title ?? "").trim(),
          prose: (p.prose ?? "").trim(),
          findingRefs: (p.findingRefs ?? []).filter((ref) => validRefs.has(ref)),
        }))
        .filter((p) => p.title && p.prose);
      if (!phases.length) return null;
      return { overview: (out.overview ?? "").trim(), phases };
    } catch (e) {
      lastErr = e;
      console.error(
        `narrative: modelo ${key} em capacidade/erro — tentando o próximo`,
        e,
      );
    }
  }
  console.error("narrative: todos os modelos falharam", lastErr);
  return null; // defensivo: o relatório cai no formato plano de achados
}
