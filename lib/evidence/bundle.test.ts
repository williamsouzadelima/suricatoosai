/**
 * @jest-environment node
 *
 * bundle.ts é um módulo Node (tar-stream + gzip + Web Streams via
 * Readable.toWeb). Sob jsdom o consumo do stream trava (causa não verificada);
 * aqui rodamos em ambiente node (o runtime das rotas de download também é
 * "nodejs"). O mock de window no jest.setup.js é guardado por `typeof window`,
 * então não quebra aqui.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import * as tar from "tar-stream";
import { buildEvidenceBundleStream } from "@/lib/evidence/bundle";
import type { EvidenceBundleRow } from "@/convex/lib/evidenceBundle";
import type { Id } from "@/convex/_generated/dataModel";

type BundleOpts = Parameters<typeof buildEvidenceBundleStream>[0];

type BundleManifest = {
  hashAlgorithm: string;
  counts: { evidence: number; files: number; missing: number };
  evidence: Array<{
    evidenceId: string;
    file: string | null;
    sha256: string | null;
    status: string;
  }>;
  missing: Array<{ evidenceId: string; s3Key: string | null; reason: string }>;
};

function row(over: Partial<EvidenceBundleRow> & { evidenceId: string }): EvidenceBundleRow {
  const { evidenceId, ...rest } = over;
  return {
    evidenceId: evidenceId as Id<"evidence">,
    findingId: "fd1" as Id<"findings">,
    findingRef: "VULN-1",
    findingTitle: "Teste",
    findingSeverity: "high",
    findingWeaknessClass: "xss",
    sourceType: "file",
    label: "prova",
    snippet: null,
    stepIndex: null,
    toolName: "browser",
    command: null,
    resultSummary: null,
    s3Key: null,
    fileId: null,
    sandboxPath: null,
    mediaType: null,
    capturedAt: 1700000000000,
    ...rest,
  };
}

const PNG_A = Buffer.from("conteudo-do-print-A-0123456789");
const PNG_B = Buffer.from("conteudo-do-print-B-abcdefghij");
const SHA_A = createHash("sha256").update(PNG_A).digest("hex");
const SHA_B = createHash("sha256").update(PNG_B).digest("hex");

const BYTES_BY_KEY: Record<string, Buffer> = {
  "s3/a.png": PNG_A,
  "s3/b.png": PNG_B,
};

function fakeS3Send() {
  return jest.fn(async (cmd: { params?: { Key?: string } }) => {
    const key = cmd?.params?.Key ?? "";
    if (key === "s3/throws.png") {
      throw Object.assign(new Error("gone"), { name: "NoSuchKey" });
    }
    const b = BYTES_BY_KEY[key];
    if (!b) throw new Error(`chave inesperada no teste: ${key}`);
    return { Body: { transformToByteArray: async () => new Uint8Array(b) } };
  });
}

async function runBundle(
  rows: EvidenceBundleRow[],
  opts: {
    send?: (cmd: { params?: { Key?: string } }) => Promise<unknown>;
    signal?: AbortSignal;
  } = {},
) {
  const web = buildEvidenceBundleStream({
    s3: { send: opts.send ?? fakeS3Send() } as unknown as BundleOpts["s3"],
    bucket: "bkt",
    engagementName: "Engajamento X",
    generatedAt: 1700000000000,
    signal: opts.signal,
    fetchPage: async () => ({
      denied: false,
      page: rows,
      isDone: true,
      continueCursor: "",
    }),
  });

  // Consome pelo reader NATIVO do stream Node retornado por Readable.toWeb —
  // evita Readable.fromWeb, que trava sob jsdom (globais de Web Streams).
  const reader = (web as ReadableStream<Uint8Array>).getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  const tarBuf = gunzipSync(Buffer.concat(chunks));

  const files: Record<string, Buffer> = {};
  await new Promise<void>((resolve, reject) => {
    const extract = tar.extract();
    extract.on("entry", (header, stream, next) => {
      const cs: Buffer[] = [];
      stream.on("data", (d) => cs.push(Buffer.from(d)));
      stream.on("end", () => {
        files[header.name] = Buffer.concat(cs);
        next();
      });
      stream.on("error", reject);
      stream.resume();
    });
    extract.on("finish", () => resolve());
    extract.on("error", reject);
    Readable.from(tarBuf).pipe(extract);
  });

  const manifest = JSON.parse(
    files["manifest.json"].toString("utf-8"),
  ) as BundleManifest;
  return { files, manifest };
}

describe("buildEvidenceBundleStream — integridade por sha256 + classificação honesta", () => {
  // ev1/ev2: MESMO objeto S3 (dedup). ev3: outro objeto. ev4: só texto.
  // ev5: objeto 404 (irrecuperável). ev6: evidência de ARQUIVO sem s3_key
  // (file_id legado) — não pode virar "text_only" calado.
  const rows = [
    row({ evidenceId: "ev1", s3Key: "s3/a.png", mediaType: "image/png", label: "a" }),
    row({ evidenceId: "ev2", s3Key: "s3/a.png", mediaType: "image/png", label: "a-dup" }),
    row({ evidenceId: "ev3", s3Key: "s3/b.png", mediaType: "image/png", label: "b" }),
    row({ evidenceId: "ev4", s3Key: null, sourceType: "note", label: "texto" }),
    row({ evidenceId: "ev5", s3Key: "s3/throws.png", mediaType: "image/png", label: "err" }),
    row({
      evidenceId: "ev6",
      s3Key: null,
      fileId: "file_legacy",
      sourceType: "file",
      mediaType: "image/png",
      label: "legacy",
    }),
    row({
      evidenceId: "ev7",
      s3Key: null,
      sourceType: "file",
      snippet: "cat /etc/app/config.yaml",
      label: "texto-rotulado-file",
    }),
  ];

  let files: Record<string, Buffer>;
  let manifest: BundleManifest;

  beforeAll(async () => {
    const out = await runBundle(rows);
    files = out.files;
    manifest = out.manifest;
  }, 20000);

  const byId = (id: string) => manifest.evidence.find((e) => e.evidenceId === id)!;

  it("declara o algoritmo de hash no manifesto", () => {
    expect(manifest.hashAlgorithm).toBe("sha256");
  });

  it("grava o sha256 do conteúdo em cada arquivo disponível", () => {
    expect(byId("ev1").status).toBe("available");
    expect(byId("ev1").sha256).toBe(SHA_A);
    expect(byId("ev3").sha256).toBe(SHA_B);
  });

  it("TODO sha256 do manifesto bate com os BYTES realmente empacotados (integridade ponta-a-ponta)", () => {
    const withFile = manifest.evidence.filter((e) => e.file !== null);
    expect(withFile.length).toBeGreaterThan(0);
    for (const e of withFile) {
      const packed = files[e.file!];
      expect(packed).toBeDefined();
      expect(e.sha256).not.toBeNull();
      expect(createHash("sha256").update(packed).digest("hex")).toBe(e.sha256);
    }
  });

  it("SHA256SUMS lista cada arquivo físico e confere com os bytes do tar", () => {
    const sums = files["SHA256SUMS"].toString("utf-8").trim().split("\n");
    // uma linha por ARQUIVO físico (dedup não repete): a.png + b.png = 2.
    expect(sums).toHaveLength(2);
    // o conjunto de caminhos em SHA256SUMS = exatamente as entradas evidence/ do tar.
    const sumPaths = sums.map((l) => l.split("  ")[1]).sort();
    const evidenceEntries = Object.keys(files)
      .filter((k) => k.startsWith("evidence/"))
      .sort();
    expect(sumPaths).toEqual(evidenceEntries);
    for (const line of sums) {
      const m = line.match(/^([0-9a-f]{64})  (.+)$/);
      expect(m).not.toBeNull();
      const [, hash, path] = m!;
      expect(files[path]).toBeDefined();
      expect(createHash("sha256").update(files[path]).digest("hex")).toBe(hash);
    }
  });

  it("dedupa objeto S3 idêntico em UM arquivo, mas carimba o hash em TODAS as entradas", () => {
    const e1 = byId("ev1");
    const e2 = byId("ev2");
    expect(e2.file).toBe(e1.file); // mesmo arquivo reusado
    expect(e2.sha256).toBe(e1.sha256); // hash reusado, nunca em branco
    expect(manifest.counts.files).toBe(2); // a.png + b.png (não 3)
  });

  it("evidência só-texto não tem sha256 nem arquivo", () => {
    expect(byId("ev4").status).toBe("text_only");
    expect(byId("ev4").sha256).toBeNull();
    expect(byId("ev4").file).toBeNull();
  });

  it("objeto irrecuperável (404): sha256 nulo, status missing, listado em missing[]", () => {
    expect(byId("ev5").status).toBe("missing");
    expect(byId("ev5").sha256).toBeNull();
    expect(byId("ev5").file).toBeNull();
    expect(manifest.missing.some((m) => m.evidenceId === "ev5")).toBe(true);
  });

  it("evidência de ARQUIVO sem s3_key vira missing/no_s3_key — nunca 'text_only' calado", () => {
    const e6 = byId("ev6");
    expect(e6.status).toBe("missing");
    expect(e6.sha256).toBeNull();
    expect(e6.file).toBeNull();
    const m = manifest.missing.find((x) => x.evidenceId === "ev6");
    expect(m).toBeDefined();
    expect(m!.reason).toBe("no_s3_key");
    expect(m!.s3Key).toBeNull();
  });

  it("texto rotulado source_type 'file' SEM ponteiro não vira missing (sem falso positivo)", () => {
    const e7 = byId("ev7");
    expect(e7.status).toBe("text_only");
    expect(e7.sha256).toBeNull();
    expect(e7.file).toBeNull();
    expect(manifest.missing.some((m) => m.evidenceId === "ev7")).toBe(false);
  });

  it("contagens honestas: 7 evidências, 2 missing (404 + file_id sem s3_key)", () => {
    expect(manifest.counts.evidence).toBe(7);
    expect(manifest.counts.missing).toBe(2);
  });
});

describe("buildEvidenceBundleStream — endurecimento (A anexo; B abort/retry/zip-slip)", () => {
  const find = (m: BundleManifest, id: string) =>
    m.evidence.find((e) => e.evidenceId === id)!;

  it("A: sandbox_path sem s3_key (anexo falhou) → missing/file_not_attached, sem vazar o caminho", async () => {
    const { manifest } = await runBundle([
      row({
        evidenceId: "a1",
        s3Key: null,
        sandboxPath: "/home/sandbox/shot.png",
        sourceType: "file",
        label: "anexo-falhou",
      }),
    ]);
    const e = find(manifest, "a1");
    expect(e.status).toBe("missing");
    expect(e.sha256).toBeNull();
    expect(e.file).toBeNull();
    const m = manifest.missing.find((x) => x.evidenceId === "a1")!;
    expect(m.reason).toBe("file_not_attached");
    // o caminho interno do sandbox NÃO vaza em lugar nenhum do manifesto
    expect(JSON.stringify(manifest)).not.toContain("/home/sandbox/");
  });

  it("B3: findingRef '..' não vira traversal no caminho do tar (zip-slip)", async () => {
    const { files, manifest } = await runBundle([
      row({
        evidenceId: "z1",
        s3Key: "s3/a.png",
        mediaType: "image/png",
        label: "a",
        findingRef: "..",
      }),
    ]);
    const e = find(manifest, "z1");
    expect(e.file).not.toBeNull();
    expect(e.file!.startsWith("evidence/")).toBe(true);
    for (const k of Object.keys(files)) {
      expect(k.includes("..")).toBe(false);
    }
  });

  it("Item5: mediaType malicioso (prototype pollution) não gera nome absurdo", async () => {
    const { files, manifest } = await runBundle([
      row({ evidenceId: "x1", s3Key: "s3/a.png", mediaType: "constructor", label: "poc" }),
      row({ evidenceId: "x2", s3Key: "s3/b.png", mediaType: "__proto__", label: "poc2" }),
    ]);
    for (const id of ["x1", "x2"]) {
      const e = find(manifest, id);
      expect(e.file).not.toBeNull();
      expect(e.file!.endsWith(".bin")).toBe(true); // extensão cai p/ .bin
      expect(e.file).not.toContain("Object");
      expect(e.file).not.toContain("function");
    }
    for (const k of Object.keys(files)) {
      expect(k.includes("Object")).toBe(false);
    }
  });

  it("B2: falha de send do S3 → missing, SEM retry da camada (o SDK já repete)", async () => {
    let calls = 0;
    const send = async () => {
      calls += 1;
      throw Object.assign(new Error("indisp"), {
        name: "ServiceUnavailable",
        $metadata: { httpStatusCode: 503 },
      });
    };
    const { manifest } = await runBundle(
      [row({ evidenceId: "p1", s3Key: "s3/x.png", mediaType: "image/png", label: "x" })],
      { send },
    );
    expect(find(manifest, "p1").status).toBe("missing");
    expect(calls).toBe(1); // a camada chama send UMA vez; o retry é do SDK
  });

  it("B1: signal já abortado → não pagina nem baixa (para cedo)", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = jest.fn();
    const fetchPage = jest.fn(async () => ({
      denied: false,
      page: [
        row({ evidenceId: "ab1", s3Key: "s3/a.png", mediaType: "image/png", label: "a" }),
      ],
      isDone: true,
      continueCursor: "",
    }));
    const web = buildEvidenceBundleStream({
      s3: { send } as unknown as BundleOpts["s3"],
      bucket: "bkt",
      engagementName: "X",
      generatedAt: 1,
      signal: controller.signal,
      fetchPage,
    });
    try {
      const reader = (web as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // stream destruído no abort — esperado
    }
    expect(fetchPage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
