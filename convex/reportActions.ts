"use node";

import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { api } from "./_generated/api";
import { generateS3DownloadUrl } from "./s3Utils";

/**
 * URL de download de um relatório pronto (identity + posse, via getReportForDownload).
 *
 * v1: URL S3 pré-assinada de curta duração. HARDENING v2 (portal do cliente):
 * trocar por um download-proxy autenticado (stream server-side, sem bearer
 * compartilhável) + bucket dedicado/SSE-KMS + auditoria por emissão, conforme o
 * desenho de segurança. Ver [[stratihawkeye]]/plano.
 */
export const getReportDownloadUrl = action({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args): Promise<{ url: string; filename: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Não autenticado",
      });
    }
    const report = await ctx.runQuery(api.reports.getReportForDownload, {
      reportId: args.reportId,
    });
    if (!report || report.status !== "ready" || !report.s3Key) {
      throw new ConvexError({
        code: "NOT_READY",
        message: "Relatório indisponível para download",
      });
    }
    const url = await generateS3DownloadUrl(report.s3Key);
    const filename = `${report.audience}_v${report.version}.${report.format}`;
    return { url, filename };
  },
});
