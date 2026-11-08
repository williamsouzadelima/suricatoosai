/** @jest-environment node */
import { describe, it, expect } from "@jest/globals";
import {
  heroNumeral,
  heroTone,
  heroSentence,
  isFullCoverage,
  truncationNotice,
  formatEvidenceCount,
  plural,
  retestPortalLabel,
  scopeCoverageLine,
  selectPriorityOrder,
  comparePriority,
  SUMMARY_TRUNCATED_COPY,
  type PortalSummary,
} from "../summary-model";

function heroInput(
  f: Partial<PortalSummary["findings"]>,
  opts: { total?: number; withFindings?: number; truncated?: boolean } = {},
): PortalSummary {
  return {
    truncated: opts.truncated ?? false,
    engagements: {
      total: opts.total ?? 1,
      withFindings: opts.withFindings ?? 1,
    },
    findings: {
      published: 0,
      publishedWithoutDate: 0,
      open: 0,
      openBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      openCriticalHigh: 0,
      worstOpenSeverity: null,
      retest: { fixed: 0, stillVulnerable: 0, pending: 0, notRetested: 0 },
      lastPublishedAt: null,
      lastRetestedAt: null,
      ...f,
    },
  } as unknown as PortalSummary;
}

// "ainda" entra no guard: a copy de AUSÊNCIA nunca deve usá-la (R2). A única
// "ainda" legítima é "ainda vulnerável" (= still vulnerable, afirmação VERDADEIRA
// do reteste) — testada por string exata no S4+sv, FORA deste loop.
const FORBIDDEN =
  /ainda|score|nota de seguran|grade|seguro|protegid|tend[êe]ncia/i;

describe("hero: numeral/tom/frase honestos + cobertura em TODA afirmação", () => {
  it("S1 sem publicados → '—', muted, SEM 'ainda'", () => {
    const s = heroInput({ published: 0 });
    expect(heroNumeral(s)).toBe("—");
    expect(heroTone(s)).toBe("muted");
    expect(heroSentence(s)).toBe("Nenhum achado publicado neste portfólio.");
  });

  it("S2 nada aberto + COBERTURA TOTAL → success", () => {
    const s = heroInput(
      { published: 3, open: 0 },
      { total: 3, withFindings: 3 },
    );
    expect(heroNumeral(s)).toBe("0");
    expect(heroTone(s)).toBe("success");
    expect(heroSentence(s)).toBe(
      "Nenhum achado em aberto: todos os 3 achados publicados foram validados por reteste.",
    );
  });

  it("S2 singular, cobertura total", () => {
    const s = heroInput(
      { published: 1, open: 0 },
      { total: 1, withFindings: 1 },
    );
    expect(heroTone(s)).toBe("success");
    expect(heroSentence(s)).toBe(
      "Nenhum achado em aberto: o único achado publicado foi validado por reteste.",
    );
  });

  it("S2 nada aberto + COBERTURA PARCIAL → NEUTRAL + qualificador (nunca falso all-clear)", () => {
    const s = heroInput(
      { published: 3, open: 0 },
      { total: 3, withFindings: 2 },
    );
    expect(heroNumeral(s)).toBe("0");
    expect(heroTone(s)).toBe("neutral");
    expect(isFullCoverage(s)).toBe(false);
    expect(heroSentence(s)).toBe(
      "Nenhum achado em aberto entre os 3 achados publicados. Cobertura: 2 de 3 engajamentos com achados publicados.",
    );
  });

  it("nada aberto + TRUNCADO → neutral + aviso de resumo parcial", () => {
    const s = heroInput(
      { published: 3, open: 0 },
      { total: 3, withFindings: 3, truncated: true },
    );
    expect(heroTone(s)).toBe("neutral");
    expect(truncationNotice(s)).toBe(SUMMARY_TRUNCATED_COPY);
    expect(heroSentence(s)).toContain(
      "Nenhum achado em aberto entre os 3 achados publicados",
    );
    expect(heroSentence(s)).toContain(SUMMARY_TRUNCATED_COPY);
  });

  it("S3 aberto sem crítico/alto, cobertura total → '0', neutral", () => {
    const s = heroInput(
      { published: 5, open: 2, openCriticalHigh: 0 },
      { total: 3, withFindings: 3 },
    );
    expect(heroNumeral(s)).toBe("0");
    expect(heroTone(s)).toBe("neutral");
    expect(heroSentence(s)).toBe(
      "2 achados em aberto, nenhum crítico ou alto.",
    );
  });

  it("R1: aberto sem crítico/alto + COBERTURA PARCIAL → qualificador anexado", () => {
    const s = heroInput(
      { published: 4, open: 2, openCriticalHigh: 0 },
      { total: 3, withFindings: 1 },
    );
    expect(heroNumeral(s)).toBe("0");
    expect(heroTone(s)).toBe("neutral");
    const sent = heroSentence(s);
    expect(sent).toContain("2 achados em aberto, nenhum crítico ou alto.");
    expect(sent).toContain(
      "Cobertura: 1 de 3 engajamentos com achados publicados.",
    );
  });

  it("R1: aberto sem crítico/alto + TRUNCADO → 'nenhum crítico ou alto' é SUAVIZADO", () => {
    const s = heroInput(
      { published: 2, open: 2, openCriticalHigh: 0 },
      { total: 1, withFindings: 1, truncated: true },
    );
    const sent = heroSentence(s);
    expect(sent).toContain("entre os achados carregados");
    expect(sent).toContain(SUMMARY_TRUNCATED_COPY);
  });

  it("S4 crítico/alto em aberto → N, destructive, +ainda vulnerável (string exata)", () => {
    const s = heroInput(
      {
        published: 5,
        open: 4,
        openCriticalHigh: 2,
        openBySeverity: { critical: 2, high: 0, medium: 1, low: 1, info: 0 },
        retest: { fixed: 0, stillVulnerable: 1, pending: 0, notRetested: 4 },
      },
      { total: 3, withFindings: 3 },
    );
    expect(heroNumeral(s)).toBe("2");
    expect(heroTone(s)).toBe("destructive");
    expect(heroSentence(s)).toBe(
      "4 de 5 publicados seguem em aberto: 2 críticos e 0 altos. 1 confirmado ainda vulnerável no reteste.",
    );
  });

  it("R1: crítico/alto + TRUNCADO → contagem crit/alto + aviso de resumo parcial", () => {
    const s = heroInput(
      {
        published: 5,
        open: 3,
        openCriticalHigh: 2,
        openBySeverity: { critical: 2, high: 0, medium: 1, low: 0, info: 0 },
        retest: { fixed: 0, stillVulnerable: 0, pending: 0, notRetested: 3 },
      },
      { total: 1, withFindings: 1, truncated: true },
    );
    const sent = heroSentence(s);
    expect(sent).toContain("2 críticos e 0 altos");
    expect(sent).toContain(SUMMARY_TRUNCATED_COPY);
  });

  it("copy-guard: nenhuma frase de AUSÊNCIA usa 'ainda'/termo proibido", () => {
    const inputs = [
      heroInput({ published: 0 }),
      heroInput({ published: 3, open: 0 }, { total: 3, withFindings: 3 }),
      heroInput({ published: 1, open: 0 }),
      heroInput({ published: 3, open: 0 }, { total: 3, withFindings: 2 }),
      heroInput(
        { published: 3, open: 0 },
        { total: 3, withFindings: 3, truncated: true },
      ),
      heroInput(
        { published: 5, open: 2, openCriticalHigh: 0 },
        { total: 3, withFindings: 3 },
      ),
      heroInput(
        { published: 4, open: 2, openCriticalHigh: 0 },
        { total: 3, withFindings: 1 },
      ),
      // S4 SEM still_vulnerable (sv=0) → sem "ainda vulnerável" legítimo
      heroInput(
        {
          published: 5,
          open: 4,
          openCriticalHigh: 2,
          openBySeverity: { critical: 2, high: 0, medium: 1, low: 1, info: 0 },
          retest: { fixed: 0, stillVulnerable: 0, pending: 0, notRetested: 4 },
        },
        { total: 3, withFindings: 3 },
      ),
    ];
    for (const s of inputs) expect(heroSentence(s)).not.toMatch(FORBIDDEN);
    expect(scopeCoverageLine(2, 5)).toBe("Escopo registrado em 2 de 5");
    expect(scopeCoverageLine(2, 5)).not.toMatch(FORBIDDEN);
  });
});

describe("evidenceCount / plural / rótulo de reteste", () => {
  it("formatEvidenceCount: '200+' no teto, exato abaixo", () => {
    expect(formatEvidenceCount(0)).toBe("0");
    expect(formatEvidenceCount(5)).toBe("5");
    expect(formatEvidenceCount(199)).toBe("199");
    expect(formatEvidenceCount(200)).toBe("200+");
  });
  it("plural", () => {
    expect(plural(1, "um", "muitos")).toBe("um");
    expect(plural(2, "um", "muitos")).toBe("muitos");
    expect(plural(0, "um", "muitos")).toBe("muitos");
  });
  it("retestPortalLabel (vocabulário client-facing)", () => {
    expect(retestPortalLabel("fixed")).toBe("Validado por reteste");
    expect(retestPortalLabel("still_vulnerable")).toBe("Ainda vulnerável");
    expect(retestPortalLabel("pending")).toBe("Reteste pendente");
    expect(retestPortalLabel(null)).toBe("Sem reteste");
    expect(retestPortalLabel("qualquer")).toBe("Sem reteste");
  });
});

describe("comparador de prioridade (fonte única servidor/UI)", () => {
  it("severidade desc → cvss desc (nulo por último) → publicado desc (nulo por último) → id asc", () => {
    const items = [
      { severity: "low", cvssScore: null, publishedAt: null, id: "z" },
      { severity: "critical", cvssScore: 9.1, publishedAt: 100, id: "a" },
      { severity: "critical", cvssScore: 9.8, publishedAt: 50, id: "b" },
      { severity: "critical", cvssScore: null, publishedAt: 999, id: "c" },
      { severity: "high", cvssScore: 7.0, publishedAt: 10, id: "d" },
    ];
    expect(selectPriorityOrder(items).map((x) => x.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
      "z",
    ]);
  });

  it("desempate por id asc quando tudo igual", () => {
    const a = { severity: "high", cvssScore: 7, publishedAt: 5, id: "aaa" };
    const b = { severity: "high", cvssScore: 7, publishedAt: 5, id: "bbb" };
    expect(comparePriority(a, b)).toBeLessThan(0);
    expect(comparePriority(b, a)).toBeGreaterThan(0);
    expect(comparePriority(a, a)).toBe(0);
  });
});
