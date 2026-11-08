import {
  isInlineSafeMediaType,
  inlineSafeContentType,
  sanitizeHeaderFilename,
  contentDispositionFor,
} from "./media-disposition";

describe("isInlineSafeMediaType", () => {
  it("raster seguro → true", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isInlineSafeMediaType(t)).toBe(true);
    }
  });
  it("pdf → true", () => {
    expect(isInlineSafeMediaType("application/pdf")).toBe(true);
  });
  it("SVG → false (carrega script)", () => {
    expect(isInlineSafeMediaType("image/svg+xml")).toBe(false);
  });
  it("HTML/XML/octet-stream/texto → false", () => {
    for (const t of [
      "text/html",
      "application/xhtml+xml",
      "application/xml",
      "text/xml",
      "application/octet-stream",
      "text/plain",
    ]) {
      expect(isInlineSafeMediaType(t)).toBe(false);
    }
  });
  it("ausente/vazio/desconhecido → false (padrão seguro)", () => {
    expect(isInlineSafeMediaType(undefined)).toBe(false);
    expect(isInlineSafeMediaType(null)).toBe(false);
    expect(isInlineSafeMediaType("")).toBe(false);
    expect(isInlineSafeMediaType("application/x-foo")).toBe(false);
  });
  it("normaliza caixa e parâmetros", () => {
    expect(isInlineSafeMediaType("IMAGE/PNG")).toBe(true);
    expect(isInlineSafeMediaType("image/png; charset=binary")).toBe(true);
    expect(isInlineSafeMediaType("  image/webp  ")).toBe(true);
    // Um tipo perigoso com parâmetro continua perigoso:
    expect(isInlineSafeMediaType("text/html; charset=utf-8")).toBe(false);
  });
});

describe("sanitizeHeaderFilename", () => {
  it("remove CR/LF/aspas/barra (anti header-injection)", () => {
    const out = sanitizeHeaderFilename('evil".ext\r\nSet-Cookie: x=1');
    expect(out).toBeDefined();
    expect(out).not.toContain('"');
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\\");
  });
  it("mantém nome normal", () => {
    expect(sanitizeHeaderFilename("relatório final (1).pdf")).toBe(
      "relatório final (1).pdf",
    );
  });
  it("vazio/só-controle → undefined", () => {
    expect(sanitizeHeaderFilename(undefined)).toBeUndefined();
    expect(sanitizeHeaderFilename("")).toBeUndefined();
    expect(sanitizeHeaderFilename("\r\n\t")).toBeUndefined();
  });
  it("trunca nomes muito longos", () => {
    const out = sanitizeHeaderFilename("a".repeat(500));
    expect(out).toHaveLength(200);
  });

  it("#N1 trunca por CODE POINTS — emoji na borda não vira surrogate solto", () => {
    // 199 "a" + 1 emoji = 200 code points → mantém o emoji inteiro.
    expect(sanitizeHeaderFilename("a".repeat(199) + "😀")).toBe(
      "a".repeat(199) + "😀",
    );
    // 200 "a" + 1 emoji = 201 code points → corta o emoji INTEIRO (não pela metade).
    const out = sanitizeHeaderFilename("a".repeat(200) + "😀");
    expect(out).toBe("a".repeat(200));
    expect(Array.from(out ?? "")).toHaveLength(200);
  });
});

describe("contentDispositionFor", () => {
  it("raster/pdf → inline", () => {
    expect(contentDispositionFor("image/png")).toBe("inline");
    expect(contentDispositionFor("application/pdf")).toBe("inline");
  });
  it("SVG/HTML/desconhecido/ausente → attachment", () => {
    expect(contentDispositionFor("image/svg+xml")).toBe("attachment");
    expect(contentDispositionFor("text/html")).toBe("attachment");
    expect(contentDispositionFor(undefined)).toBe("attachment");
    expect(contentDispositionFor("application/octet-stream")).toBe("attachment");
  });
  it("anexa filename sanitizado", () => {
    expect(contentDispositionFor("image/png", "foto.png")).toBe(
      'inline; filename="foto.png"',
    );
    expect(contentDispositionFor("image/svg+xml", "x.svg")).toBe(
      'attachment; filename="x.svg"',
    );
  });
  it("filename perigoso não injeta header", () => {
    const out = contentDispositionFor("text/html", 'a"\r\nX: y');
    expect(out.startsWith("attachment;")).toBe(true);
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\n");
  });
});

describe("inlineSafeContentType (pin anti label-mismatch, Finding 1)", () => {
  it("retorna o tipo canônico p/ inline-safe", () => {
    expect(inlineSafeContentType("image/png")).toBe("image/png");
    expect(inlineSafeContentType("application/pdf")).toBe("application/pdf");
  });
  it("normaliza alias image/jpg → image/jpeg (e é inline-safe)", () => {
    expect(inlineSafeContentType("image/jpg")).toBe("image/jpeg");
    expect(isInlineSafeMediaType("image/jpg")).toBe(true);
  });
  it("undefined p/ tipo não-inline-safe (não se pina nada → attachment)", () => {
    expect(inlineSafeContentType("image/svg+xml")).toBeUndefined();
    expect(inlineSafeContentType("text/html")).toBeUndefined();
    expect(inlineSafeContentType(undefined)).toBeUndefined();
    expect(inlineSafeContentType("application/octet-stream")).toBeUndefined();
  });
  it("normaliza caixa/parâmetros antes de decidir", () => {
    expect(inlineSafeContentType("IMAGE/PNG; charset=binary")).toBe("image/png");
  });
});
