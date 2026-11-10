import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
} from "node:crypto";
import * as tar from "tar-stream";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { brtFilenameStamp } from "@/lib/reports/report-filename";
import type { EvidenceBundleRow } from "@/convex/lib/evidenceBundle";

/**
 * Monta o .tar.gz de TODA a evidência do engajamento ON-THE-FLY (sempre atual).
 * Streama (tar-stream + gzip) — bufferiza UM objeto do S3 por vez (screenshots
 * são pequenos), então é memory-safe sem artefato pré-gerado. SHA256SUMS (se há
 * arquivos), o manifesto e o README são as ÚLTIMAS entradas (só então se conhece
 * `missing[]`; e um stream que morre no meio fica sem manifesto → truncamento
 * detectável). "Sem exceção" é honesto: evidência não empacotada (objeto 404,
 * sem s3_key, ou erro de leitura) vai pra `missing[]`, nunca some calado.
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

function readmeFor(signed: boolean, fingerprint: string): string {
  const fileList = [
    "- manifest.json : catalogo completo (achados, comandos, provas, metadados) +",
    '  o \'sha256\' de cada arquivo empacotado + a lista "missing" de evidencia nao',
    "  empacotada (nunca omitida em silencio).",
    "- SHA256SUMS    : linhas 'sha256  caminho' (presente so quando ha arquivos);",
    "  valide com 'sha256sum -c SHA256SUMS' a partir da raiz extraida.",
    ...(signed
      ? [
          "- manifest.json.sig / manifest.pub : assinatura Ed25519 do manifest.json + a",
          "  chave publica que a verifica; 'node verify.mjs' faz a verificacao.",
        ]
      : []),
    "- evidence/<achado>/<arquivo> : screenshots e arquivos capturados.",
  ].join("\n");
  const integrity = signed
    ? `Integridade + AUTENTICIDADE (cadeia de custodia): o 'sha256' detecta corrupcao
ou edicao de um arquivo vs. este manifesto; e o manifest.json esta ASSINADO
(Ed25519 — manifest.json.sig, chave em manifest.pub, fingerprint sha256
${fingerprint}). Como o manifesto carrega o sha256 de cada arquivo, a assinatura
prova que o pacote inteiro e exatamente o que a Suricatoos gerou e nao foi
reescrito — reescrever invalida a assinatura. Verifique com 'node verify.mjs'
(ou sua propria ferramenta) e confira o fingerprint de manifest.pub contra a
chave publicada da Suricatoos.`
    : `Integridade do conteudo: o 'sha256' detecta corrupcao ou edicao de um arquivo
em relacao a este manifesto. O manifesto NAO e assinado e os hashes sao
calculados na exportacao — isto comprova integridade do conteudo empacotado,
nao autenticidade nem cadeia de custodia (quem reescreve o pacote tambem
recalcula o hash).`;
  return `Pacote de evidencias - Suricatoos

Este .tar.gz contem TODA a evidencia do engajamento (export forense completo):
${fileList}

${integrity}

Conteudo CONFIDENCIAL. Distribua apenas conforme o contrato do engajamento.
`;
}

const MANIFEST_NOTE_UNSIGNED =
  "Export completo de evidencia. 'sha256' (algoritmo em hashAlgorithm) e o hash do conteudo de cada ARQUIVO empacotado em evidence/, repetido em SHA256SUMS para 'sha256sum -c'. Comprova integridade do conteudo vs. este manifesto (nao assinado; hash calculado na exportacao), nao autenticidade. Campos de texto (snippet/command/resultSummary) e o proprio manifesto nao sao hasheados. 'missing' lista evidencia nao empacotada (sem s3_key, objeto ausente no S3, ou erro de leitura); 'warnings' sinaliza truncamento.";

const MANIFEST_NOTE_SIGNED =
  "Export completo de evidencia, com MANIFESTO ASSINADO (Ed25519). 'sha256' (algoritmo em hashAlgorithm) e o hash do conteudo de cada ARQUIVO empacotado, repetido em SHA256SUMS. 'manifest.json.sig' assina o conteudo EXATO deste manifest.json com a chave em 'manifest.pub' — como o manifesto carrega o sha256 de cada arquivo, a assinatura autentica o pacote inteiro (reescrever invalida). Verifique com 'node verify.mjs' e confira o fingerprint (signature.keyFingerprint) contra a chave publicada da Suricatoos. 'missing' lista evidencia nao empacotada; 'warnings' sinaliza truncamento.";

const VERIFY_MJS = `// verify.mjs — verifica a assinatura do manifesto deste pacote. Rode: node verify.mjs
import { readFileSync } from "node:fs";
import { createPublicKey, verify, createHash } from "node:crypto";
try {
  const manifest = readFileSync("manifest.json");
  const sig = Buffer.from(readFileSync("manifest.json.sig", "utf-8").trim(), "base64");
  const pub = createPublicKey(readFileSync("manifest.pub", "utf-8"));
  if (!verify(null, manifest, pub, sig)) {
    console.error("FAIL: a assinatura NAO corresponde a manifest.json (pacote alterado?).");
    process.exit(1);
  }
  const fp = createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex").slice(0, 32);
  console.log("OK: manifest.json esta integro e assinado pela chave inclusa.");
  console.log("fingerprint da chave (sha256, 32 hex): " + fp);
  console.log("Confirme este fingerprint com a chave publicada da Suricatoos para garantir autenticidade.");
} catch (e) {
  console.error("ERRO ao verificar: " + (e && e.message ? e.message : String(e)));
  process.exit(2);
}
`;

/**
 * Assinante Ed25519 do manifesto. A chave privada (PKCS8 PEM) vem de
 * EVIDENCE_SIGNING_KEY; ausente/invalida => NAO assina (bundle byte-identico ao
 * caminho sem assinatura = zero regressao). Assinar o manifesto — que carrega o
 * sha256 de CADA arquivo — autentica o pacote inteiro: o destinatario verifica a
 * assinatura com a chave publica inclusa e confere o fingerprint dela contra a
 * chave publicada da Suricatoos.
 */
function getManifestSigner():
  | { sign: (b: Buffer) => Buffer; pubPem: string; fingerprint: string }
  | null {
  const pem = process.env.EVIDENCE_SIGNING_KEY;
  if (!pem || !pem.trim()) return null;
  try {
    const priv = createPrivateKey(pem);
    if (priv.asymmetricKeyType !== "ed25519") return null;
    const pub = createPublicKey(priv);
    const pubPem = pub.export({ type: "spki", format: "pem" }) as string;
    const pubDer = pub.export({ type: "spki", format: "der" }) as Buffer;
    const fingerprint = createHash("sha256")
      .update(pubDer)
      .digest("hex")
      .slice(0, 32);
    return { sign: (b) => edSign(null, b, priv), pubPem, fingerprint };
  } catch {
    // Chave mal-configurada NUNCA assina com lixo em silencio: cai pro caminho
    // nao-assinado (honesto) em vez de produzir uma assinatura invalida.
    return null;
  }
}

function extFor(mt: string | null): string {
  if (!mt) return "bin";
  const k = mt.toLowerCase();
  // hasOwnProperty: mediaType vem do LLM; sem isto, "constructor"/"__proto__"
  // resolveriam para membros herdados de Object.prototype (função/objeto) e
  // virariam nomes de arquivo absurdos no tar.
  return Object.prototype.hasOwnProperty.call(EXT, k) ? EXT[k] : "bin";
}

function sanitize(s: string): string {
  let out = (s || "x")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  // Nunca deixar o componente ser "." ou ".." — viraria traversal no caminho do
  // tar (zip-slip na extração). Neutraliza para "_".
  if (out === "." || out === "..") out = "_";
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

/**
 * Baixa um objeto do S3. NÃO adicionamos retry aqui: o S3Client já repete erros
 * transitórios (retry padrão do SDK) — uma segunda camada apenas MULTIPLICARIA as
 * requisições (e pioraria throttling). Passamos o abortSignal para cancelar o GET
 * em voo quando o cliente desiste. Lança se os bytes não vierem — o chamador
 * registra em missing[].
 */
async function fetchS3Bytes(
  s3: S3Client,
  bucket: string,
  key: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) throw new Error("aborted");
  const obj = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    signal ? { abortSignal: signal } : undefined,
  );
  const body = obj.Body as
    | { transformToByteArray: () => Promise<Uint8Array> }
    | undefined;
  if (!body) throw new Error("empty_body");
  return await body.transformToByteArray();
}

export function buildEvidenceBundleStream(opts: {
  s3: S3Client;
  bucket: string;
  engagementName: string;
  generatedAt: number;
  fetchPage: (cursor: string | null) => Promise<EvidencePage>;
  // Cancela a geração quando o cliente desiste do download (para de paginar o
  // Convex e de baixar do S3 — poupa egress/queries em download abandonado).
  signal?: AbortSignal;
}): ReadableStream {
  const pack = tar.pack();
  // O erro do pack já chega ao consumidor pelo gzStream; sem ESTE listener, um
  // pack.destroy() (ex.: cliente aborta o download) emitiria 'error' sem ouvinte
  // → uncaughtException a cada download abandonado. O driver recebe as falhas de
  // escrita pelos callbacks de addBufferEntry.
  pack.on("error", () => {});
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
    const s3KeyToSha = new Map<string, string>();
    const sha256Sums: string[] = [];
    let fileCount = 0;
    let evidenceCount = 0;
    try {
      let cursor: string | null = null;
      do {
        if (opts.signal?.aborted) break;
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
          if (opts.signal?.aborted) break;
          evidenceCount++;
          let filePath: string | null = null;
          let sha256: string | null = null;
          let status: "available" | "missing" | "text_only" = "text_only";
          if (ev.s3Key) {
            const existing = s3KeyToPath.get(ev.s3Key);
            if (existing) {
              filePath = existing;
              // Mesmo objeto S3 já empacotado: reusa o caminho E o hash
              // (conteúdo idêntico → mesmo sha256).
              sha256 = s3KeyToSha.get(ev.s3Key) ?? null;
              status = "available";
            } else {
              try {
                const bytes = await fetchS3Bytes(
                  opts.s3,
                  opts.bucket,
                  ev.s3Key,
                  opts.signal,
                );
                const buf = Buffer.from(bytes);
                // Hash de integridade do CONTEÚDO: sha256 do arquivo exatamente
                // como empacotado. Detecta corrupção/edição do arquivo vs. este
                // manifesto (não é assinatura: o manifesto não é assinado e o
                // hash é calculado na exportação — não prova autenticidade).
                sha256 = createHash("sha256").update(buf).digest("hex");
                filePath = entryName(ev, usedNames);
                await addBufferEntry(pack, filePath, buf);
                s3KeyToPath.set(ev.s3Key, filePath);
                s3KeyToSha.set(ev.s3Key, sha256);
                sha256Sums.push(`${sha256}  ${filePath}`);
                fileCount++;
                status = "available";
              } catch (e) {
                // Pode ter falhado APÓS atribuir filePath/sha256 (ex.: pack
                // destruído em addBufferEntry) — zera para manter o invariante
                // "file/sha256 nulos quando o arquivo não entrou no tar".
                filePath = null;
                sha256 = null;
                missing.push({
                  evidenceId: ev.evidenceId,
                  s3Key: ev.s3Key,
                  reason: errName(e),
                });
                status = "missing";
              }
            }
          } else if (ev.fileId || ev.sandboxPath) {
            // Evidência de ARQUIVO que não dá pra empacotar (sem s3_key):
            //  - file_id sem s3_key (linha legada), ou
            //  - sandbox_path sem s3_key (anexo falhou / sem sandbox na captura).
            // Marca missing — nunca "text_only" calado, que apresentaria uma
            // captura como se fosse texto, contradizendo "nunca some calado".
            // source_type NÃO é sinal: vem do LLM e texto pode vir rotulado
            // "file" sem arquivo (falso positivo → falsa perda declarada).
            const reason = ev.fileId ? "no_s3_key" : "file_not_attached";
            missing.push({
              evidenceId: ev.evidenceId,
              s3Key: null,
              reason,
            });
            status = "missing";
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
            sha256,
            status,
          });
        }
        cursor = res.isDone ? null : res.continueCursor;
      } while (cursor !== null);

      // Cliente desistiu do download: encerra sem gastar em manifesto/finalização
      // (os bytes iriam para um consumidor que já foi embora).
      if (opts.signal?.aborted) {
        pack.destroy();
        return;
      }

      const signer = getManifestSigner();
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
        hashAlgorithm: "sha256",
        signed: Boolean(signer),
        ...(signer
          ? {
              signature: {
                algorithm: "ed25519",
                signatureFile: "manifest.json.sig",
                publicKeyFile: "manifest.pub",
                keyFingerprint: signer.fingerprint,
              },
            }
          : {}),
        evidence: manifestEvidence,
        missing,
        warnings,
        note: signer ? MANIFEST_NOTE_SIGNED : MANIFEST_NOTE_UNSIGNED,
      };
      if (sha256Sums.length > 0) {
        await addBufferEntry(
          pack,
          "SHA256SUMS",
          Buffer.from(sha256Sums.join("\n") + "\n", "utf-8"),
        );
      }
      // Assina os BYTES EXATOS de manifest.json que vao no tar — a assinatura
      // cobre o manifesto, que por sua vez carrega o sha256 de cada arquivo.
      const manifestBytes = Buffer.from(
        JSON.stringify(manifest, null, 2),
        "utf-8",
      );
      await addBufferEntry(pack, "manifest.json", manifestBytes);
      if (signer) {
        const sigB64 = signer.sign(manifestBytes).toString("base64");
        await addBufferEntry(
          pack,
          "manifest.json.sig",
          Buffer.from(sigB64 + "\n", "utf-8"),
        );
        await addBufferEntry(
          pack,
          "manifest.pub",
          Buffer.from(signer.pubPem, "utf-8"),
        );
        await addBufferEntry(pack, "verify.mjs", Buffer.from(VERIFY_MJS, "utf-8"));
      }
      await addBufferEntry(
        pack,
        "README.txt",
        Buffer.from(
          readmeFor(Boolean(signer), signer?.fingerprint ?? ""),
          "utf-8",
        ),
      );
      pack.finalize();
    } catch (e) {
      // Erro inesperado no driver → quebra o stream (sem manifesto = truncamento
      // detectável pelo destinatário).
      pack.destroy(e as Error);
    }
  })();

  return Readable.toWeb(gzStream) as unknown as ReadableStream;
}
