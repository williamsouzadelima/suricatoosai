/** @jest-environment node */
import { describe, it, expect } from "@jest/globals";
import {
  heroNumeral,
  heroTone,
  heroSentence,
  plural,
  retestPortalLabel,
  scopeCoverageLine,
  selectPriorityOrder,
  comparePriority,
  type PortalSummary,
} from "../summary-model";

function heroInput(f: Partial<PortalSummary["findings"]>): PortalSummary {
  return {
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

const FORBIDDEN = /score|nota de seguran|grade|seguro|protegid|tend[êe]ncia/i;

describe("hero: numeral/tom/frase honestos", () => {
  it("S1 sem publicados → '—', muted, ausência não é limpo", () => {
    const s = heroInput({ published: 0 });
    expect(heroNumeral(s)).toBe("—");
    expect(heroTone(s)).toBe("muted");
    expect(heroSentence(s)).toBe(
      "Nenhum achado publicado neste portfólio ainda.",
    );
  });

  it("S2 publicados mas nada aberto → '0', success", () => {
    const s = heroInput({ published: 3, open: 0 });
    expect(heroNumeral(s)).toBe("0");
    expect(heroTone(s)).toBe("success");
    expect(heroSentence(s)).toContain("todos os 3 achados publicados");
    expect(heroSentence(s)).toContain("validados por reteste");
  });

  it("S2 singular", () => {
    const s = heroInput({ published: 1, open: 0 });
    expect(heroSentence(s)).toBe(
      "Nenhum achado em aberto: o único achado publicado foi validado por reteste.",
    );
  });

  it("S3 aberto sem crítico/alto → '0', neutral", () => {
    const s = heroInput({ published: 5, open: 2, openCriticalHigh: 0 });
    expect(heroNumeral(s)).toBe("0");
    expect(heroTone(s)).toBe("neutral");
    expect(heroSentence(s)).toBe(
      "2 achados em aberto, nenhum crítico ou alto.",
    );
  });

  it("S4 crítico/alto em aberto → N, destructive, +ainda vulnerável", () => {
    const s = heroInput({
      published: 5,
      open: 4,
      openCriticalHigh: 2,
      openBySeverity: { critical: 2, high: 0, medium: 1, low: 1, info: 0 },
      retest: { fixed: 0, stillVulnerable: 1, pending: 0, notRetested: 4 },
    });
    expect(heroNumeral(s)).toBe("2");
    expect(heroTone(s)).toBe("destructive");
    expect(heroSentence(s)).toBe(
      "4 de 5 publicados seguem em aberto: 2 críticos e 0 altos. 1 confirmado ainda vulnerável no reteste.",
    );
  });

  it("copy-guard: nenhuma frase do herói usa termo proibido", () => {
    const inputs = [
      heroInput({ published: 0 }),
      heroInput({ published: 3, open: 0 }),
      heroInput({ published: 1, open: 0 }),
      heroInput({ published: 5, open: 2, openCriticalHigh: 0 }),
      heroInput({
        published: 5,
        open: 4,
        openCriticalHigh: 2,
        openBySeverity: { critical: 2, high: 0, medium: 1, low: 1, info: 0 },
        retest: { fixed: 0, stillVulnerable: 1, pending: 0, notRetested: 4 },
      }),
    ];
    for (const s of inputs) {
      expect(heroSentence(s)).not.toMatch(FORBIDDEN);
    }
    expect(scopeCoverageLine(2, 5)).toBe("Escopo registrado em 2 de 5");
    expect(scopeCoverageLine(2, 5)).not.toMatch(FORBIDDEN);
  });
});

describe("plural / rótulo de reteste", () => {
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
      "b", // critical cvss9.8
      "a", // critical cvss9.1
      "c", // critical cvss null (por último entre críticos)
      "d", // high
      "z", // low
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
