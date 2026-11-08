import { mapEngineFinding, normalizeSeverity } from "./map-finding";
import type { EngineFindingIngest, ResolvedImageUpload } from "./types";

function baseIngest(
  overrides: Partial<EngineFindingIngest> = {},
): EngineFindingIngest {
  return {
    engagementId: "eng_123",
    userId: "user_abc",
    title: "IDOR em /api/orders",
    affectedAsset: "api.cliente.com",
    weaknessClass: "idor",
    severity: "high",
    ...overrides,
  };
}

function upload(
  field: string,
  over: Partial<ResolvedImageUpload> = {},
): ResolvedImageUpload {
  return {
    field,
    file_id: `file_${field}`,
    s3_key: `users/user_abc/${field}.png`,
    media_type: "image/png",
    ...over,
  };
}

describe("normalizeSeverity", () => {
  it("passa o enum do platform direto", () => {
    expect(normalizeSeverity("critical")).toBe("critical");
    expect(normalizeSeverity("info")).toBe("info");
  });

  it("normaliza caixa e sinônimos", () => {
    expect(normalizeSeverity("High")).toBe("high");
    expect(normalizeSeverity("  MEDIUM ")).toBe("medium");
    expect(normalizeSeverity("informational")).toBe("info");
    expect(normalizeSeverity("crit")).toBe("critical");
  });

  it("lança em severidade desconhecida", () => {
    expect(() => normalizeSeverity("super-bad")).toThrow(/desconhecida/);
  });
});

describe("mapEngineFinding", () => {
  it("mapeia campos base e força origin agent", () => {
    const out = mapEngineFinding(baseIngest({ narrative: "# Relatório" }), []);
    expect(out.engagementId).toBe("eng_123");
    expect(out.userId).toBe("user_abc");
    expect(out.origin).toBe("agent");
    expect(out.title).toBe("IDOR em /api/orders");
    expect(out.affectedAsset).toBe("api.cliente.com");
    expect(out.weaknessClass).toBe("idor");
    expect(out.severity).toBe("high");
    expect(out.narrative).toBe("# Relatório");
    expect(out.evidence).toEqual([]);
  });

  it("imagem vira source_type file com file_id/s3_key/media_type", () => {
    const ingest = baseIngest({
      images: [{ field: "img0", label: "XSS executado", tool_name: "browser" }],
    });
    const out = mapEngineFinding(ingest, [upload("img0")]);
    expect(out.evidence).toHaveLength(1);
    const ev = out.evidence[0];
    expect(ev.source_type).toBe("file");
    expect(ev.file_id).toBe("file_img0");
    expect(ev.s3_key).toBe("users/user_abc/img0.png");
    expect(ev.media_type).toBe("image/png");
    expect(ev.label).toBe("XSS executado");
    expect(ev.tool_name).toBe("browser");
  });

  it("uniquifica labels repetidos (nunca descarta print em silêncio)", () => {
    const ingest = baseIngest({
      images: [
        { field: "a", label: "prova" },
        { field: "b", label: "prova" },
        { field: "c", label: "prova" },
      ],
    });
    const out = mapEngineFinding(ingest, [upload("a"), upload("b"), upload("c")]);
    expect(out.evidence).toHaveLength(3);
    const labels = out.evidence.map((e) => e.label);
    expect(new Set(labels).size).toBe(3);
    expect(labels).toEqual(["prova", "prova (2)", "prova (3)"]);
  });

  it("uniquifica label de imagem que colide com evidência textual", () => {
    const ingest = baseIngest({
      textEvidence: [{ label: "evidência" }],
      images: [{ field: "a", label: "evidência" }],
    });
    const out = mapEngineFinding(ingest, [upload("a")]);
    expect(out.evidence.map((e) => e.label)).toEqual([
      "evidência",
      "evidência (2)",
    ]);
  });

  it("#F5 sufixo literal pré-existente não colide: [X, X, X (2)] → 3 rótulos únicos", () => {
    // Bug do reviewer: o uniquify antigo gerava DOIS "X (2)" (o 2º X virava
    // "X (2)" e colidia com o literal "X (2)") → um print era descartado no dedup.
    const ingest = baseIngest({
      textEvidence: [{ label: "X" }, { label: "X" }, { label: "X (2)" }],
    });
    const out = mapEngineFinding(ingest, []);
    const labels = out.evidence.map((e) => e.label);
    expect(new Set(labels).size).toBe(3);
    expect(labels).toEqual(["X", "X (2)", "X (2) (2)"]);
  });

  it("lança se uma imagem declarada não tem upload resolvido", () => {
    const ingest = baseIngest({ images: [{ field: "missing", label: "x" }] });
    expect(() => mapEngineFinding(ingest, [])).toThrow(/sem upload resolvido/);
  });

  it("lança se o upload não for image/*", () => {
    const ingest = baseIngest({ images: [{ field: "a", label: "x" }] });
    expect(() =>
      mapEngineFinding(ingest, [upload("a", { media_type: "text/plain" })]),
    ).toThrow(/não é imagem/);
  });

  it("evidência textual: default note, preserva http explícito", () => {
    const ingest = baseIngest({
      textEvidence: [
        { label: "req/resp", source_type: "http", snippet: "GET /x" },
        { label: "nota" },
      ],
    });
    const out = mapEngineFinding(ingest, []);
    expect(out.evidence[0].source_type).toBe("http");
    expect(out.evidence[0].snippet).toBe("GET /x");
    expect(out.evidence[1].source_type).toBe("note");
  });
});
