import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import * as tar from "tar-stream";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { brtFilenameStamp } from "@/lib/reports/report-filename";
import type { EvidenceBundleRow } from "@/convex/lib/evidenceBundle";

/**
 * Monta o .tar.gz de TODA a evidência do engajamento ON-THE-FLY (sempre atual).
 * Streama (tar-stream + gzip) — bufferiza UM objeto do S3 por vez (screenshots
 * são pequenos), então é memory-safe sem artefato pré-gerado. O manifesto é a
 * ÚLTIMA entrada (só então se conhece `missing[]`; e um stream que morre no meio
 * fica sem manifesto → truncamento detectável). "Sem exceção" é honesto: objeto
 * irrecuperável (404) vai pra `missing[]`, nunca some calado.
 */

type EvidencePage = {
  denied: boolean;
  page: EvidenceBundleRow[];
  isDone: boolean;
  continueCursor: string;
};

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/json": "json",
};

const README = `Pacote de evidencias - Suricatoos

Este .tar.gz contem TODA a evidencia do engajamento (export forense completo):
- manifest.json : catalogo completo (achados, comandos, provas, metadados) +
  a lista "missing" de objetos irrecuperaveis (nunca omitidos em silencio).
- evidence/<achado>/<arquivo> : screenshots e arquivos capturados.

Conteudo CONFIDENCIAL. Distribua apenas conforme o contrato do engajamento.
`;

function extFor(mt: string | null): string {
  if (!mt) return "bin";
  return EXT[mt.toLowerCase()] ?? "bin";
}

function sanitize(s: string): string {
  const out = (s || "x")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  return out || "x";
}

function entryName(ev: EvidenceBundleRow, used: Set<string>): string {
  const folder = sanitize(ev.findingRef || ev.findingId);
  const base = sanitize(ev.label || "evidencia");
  const ext = extFor(ev.mediaType);
  let name = `evidence/${folder}/${base}.${ext}`;
  let i = 2;
  while (used.has(name)) {
    name = `evidence/${folder}/${base}_${i}.${ext}`;
    i++;
  }
  used.add(name);
  return name;
}

function addBufferEntry(pack: tar.Pack, name: string, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    pack.entry({ name }, buf, (err) => (err ? reject(err) : resolve()));
  });
}

function errName(e: unknown): string {
  if (e && typeof e === "object" && "name" in e) {
    return String((e as { name: unknown }).name);
  }
  return "error";
}

export function buildEvidenceBundleStream(opts: {
  s3: S3Client;
  bucket: string;
  engagementName: string;
  generatedAt: number;
  fetchPage: (cursor: string | null) => Promise<EvidencePage>;
}): ReadableStream {
  const pack = tar.pack();
  const gzip = createGzip({ level: 1 });
  const gzStream = pack.pipe(gzip);

  // Driver assíncrono: pagina a enumeração, streama cada objeto do S3 pro tar,
  // e emite o manifesto por último. Rodado em background; o backpressure do
  // consumidor pausa o driver (addBufferEntry só resolve quando a entrada drena).
  void (async () => {
    const missing: Array<{
      evidenceId: string;
      s3Key: string | null;
      reason: string;
    }> = [];
    const manifestEvidence: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];
    const usedNames = new Set<string>();
    const s3KeyToPath = new Map<string, string>();
    let fileCount = 0;
    let evidenceCount = 0;
    try {
      let cursor: string | null = null;
      do {
        const res = await opts.fetchPage(cursor);
        if (res.denied) {
          // Acesso revogado / engajamento removido NO MEIO da geração: os
          // headers 200 já foram enviados, então não dá pra 403 — mas registra
          // no manifesto (nunca truncar calado) e para.
          warnings.push(
            "Acesso negado durante a geracao (revogado ou engajamento removido) — o pacote pode estar incompleto.",
          );
          break;
        }
        for (const ev of res.page) {
          evidenceCount++;
          let filePath: string | null = null;
          let status: "available" | "missing" | "text_only" = "text_only";
          if (ev.s3Key) {
            const existing = s3KeyToPath.get(ev.s3Key);
            if (existing) {
              filePath = existing;
              status = "available";
            } else {
              try {
                const obj = await opts.s3.send(
                  new GetObjectCommand({ Bucket: opts.bucket, Key: ev.s3Key }),
                );
                const body = obj.Body as
                  | { transformToByteArray: () => Promise<Uint8Array> }
                  | undefined;
                if (!body) throw new Error("empty_body");
                const bytes = await body.transformToByteArray();
                filePath = entryName(ev, usedNames);
                await addBufferEntry(pack, filePath, Buffer.from(bytes));
                s3KeyToPath.set(ev.s3Key, filePath);
                fileCount++;
                status = "available";
              } catch (e) {
                missing.push({
                  evidenceId: ev.evidenceId,
                  s3Key: ev.s3Key,
                  reason: errName(e),
                });
                status = "missing";
              }
            }
          }
          manifestEvidence.push({
            evidenceId: ev.evidenceId,
            finding: {
              id: ev.findingId,
              ref: ev.findingRef,
              title: ev.findingTitle,
              severity: ev.findingSeverity,
              weaknessClass: ev.findingWeaknessClass,
            },
            sourceType: ev.sourceType,
            label: ev.label,
            stepIndex: ev.stepIndex,
            toolName: ev.toolName,
            command: ev.command,
            resultSummary: ev.resultSummary,
            snippet: ev.snippet,
            mediaType: ev.mediaType,
            capturedAt: ev.capturedAt,
            file: filePath,
            status,
          });
        }
        cursor = res.isDone ? null : res.continueCursor;
      } while (cursor !== null);

      const manifest = {
        tool: "Suricatoos",
        kind: "evidence-bundle",
        engagement: opts.engagementName,
        generatedAt: brtFilenameStamp(opts.generatedAt),
        generatedAtMs: opts.generatedAt,
        counts: {
          evidence: evidenceCount,
          files: fileCount,
          missing: missing.length,
        },
        evidence: manifestEvidence,
        missing,
        warnings,
        note: "Export completo de evidencia. 'missing' lista objetos irrecuperaveis (expirados antes do fix de retencao, ou nunca persistidos no S3). 'warnings' sinaliza truncamento.",
      };
      await addBufferEntry(
        pack,
        "manifest.json",
        Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
      );
      await addBufferEntry(pack, "README.txt", Buffer.from(README, "utf-8"));
      pack.finalize();
    } catch (e) {
      // Erro inesperado no driver → quebra o stream (sem manifesto = truncamento
      // detectável pelo destinatário).
      pack.destroy(e as Error);
    }
  })();

  return Readable.toWeb(gzStream) as unknown as ReadableStream;
}
