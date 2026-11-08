import {
  computeMergePatch,
  sameEvidenceContent,
  isMachineDraft,
} from "./findingMerge";

const H = {
  clampText: (s: string | undefined) => s,
  clampSteps: (s: string[] | undefined) => s,
};
const VEC98 = "AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"; // CVSS 3.1 base = 9.8

describe("isMachineDraft", () => {
  it("draft criado por máquina, re-push de máquina → true", () => {
    expect(isMachineDraft({ status: "draft", created_by: "agent" }, "agent")).toBe(true);
  });
  it("in_review → false (operador curando)", () => {
    expect(isMachineDraft({ status: "in_review", created_by: "agent" }, "agent")).toBe(false);
  });
  it("criado por analista → false", () => {
    expect(isMachineDraft({ status: "draft", created_by: "user_1" }, "agent")).toBe(false);
  });
  it("re-push origin analista → false", () => {
    expect(isMachineDraft({ status: "draft", created_by: "agent" }, "analyst")).toBe(false);
  });
  it("draft com reviewed_by (defesa) → false", () => {
    expect(
      isMachineDraft({ status: "draft", created_by: "agent", reviewed_by: "user_1" }, "agent"),
    ).toBe(false);
  });
  it("draft com reviewed_by só-espaço → true (não conta como curado)", () => {
    expect(
      isMachineDraft({ status: "draft", created_by: "agent", reviewed_by: "   " }, "agent"),
    ).toBe(true);
  });
});

describe("computeMergePatch — latest-wins (motor, #2) [latestWins=true]", () => {
  it("reteste com severity MAIOR sobrescreve", () => {
    const { patch, updatedFields } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "medium" },
      { origin: "agent", severity: "critical" },
      H,
      true,
    );
    expect(patch.severity).toBe("critical");
    expect(updatedFields).toContain("severity");
  });

  it("false-positive: severity MENOR também sobrescreve", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "critical" },
      { origin: "agent", severity: "info" },
      H,
      true,
    );
    expect(patch.severity).toBe("info");
  });

  it("narrativa/steps/confidence/verdict atualizam", () => {
    const { patch } = computeMergePatch(
      {
        status: "draft",
        created_by: "agent",
        severity: "low",
        narrative: "old",
      },
      {
        origin: "agent",
        severity: "low",
        narrative: "new",
        reproductionSteps: ["s1", "s2"],
        confidence: "high",
        verdict: "confirmed",
      },
      H,
      true,
    );
    expect(patch.narrative).toBe("new");
    expect(patch.reproduction_steps).toEqual(["s1", "s2"]);
    expect(patch.confidence).toBe("high");
    expect(patch.verdict).toBe("confirmed");
  });

  it("campo novo VAZIO/ausente NÃO zera o existente", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high", narrative: "A", impact: "I" },
      { origin: "agent", severity: "high", narrative: undefined, impact: "" },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("narrative");
    expect(patch).not.toHaveProperty("impact");
  });

  it("valor IGUAL não entra em updatedFields (honesto)", () => {
    const { patch, updatedFields } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high", narrative: "same" },
      { origin: "agent", severity: "high", narrative: "same" },
      H,
      true,
    );
    expect(updatedFields).toHaveLength(0);
    expect(Object.keys(patch)).toHaveLength(0);
  });
});

describe("computeMergePatch — CVSS atômico (#B1) [latestWins=true]", () => {
  it("vetor novo válido → score DERIVADO do vetor (ignora score inconsistente enviado)", () => {
    const { patch, updatedFields } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high" },
      { origin: "agent", severity: "high", cvssVector: VEC98, cvssScore: 1.0 },
      H,
      true,
    );
    expect(patch.cvss_vector).toBe(VEC98);
    expect(patch.cvss_score).toBe(9.8); // derivado, NÃO o 1.0 enviado
    expect(updatedFields).toEqual(expect.arrayContaining(["cvss_vector", "cvss_score"]));
  });

  it("severidade muda SEM novo CVSS → limpa o par obsoleto (não deixa 9.8 ao lado de medium)", () => {
    const { patch, updatedFields } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "critical", cvss_vector: VEC98, cvss_score: 9.8 },
      { origin: "agent", severity: "low" },
      H,
      true,
    );
    expect(patch.severity).toBe("low");
    expect(Object.keys(patch)).toContain("cvss_vector");
    expect(Object.keys(patch)).toContain("cvss_score");
    expect(patch.cvss_vector).toBeUndefined();
    expect(patch.cvss_score).toBeUndefined();
    expect(updatedFields).toEqual(
      expect.arrayContaining(["severity", "cvss_vector", "cvss_score"]),
    );
  });

  it("#B1a score-only + severidade muda → limpa o par (ignora score solto; nunca 9.8 vs medium)", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "critical", cvss_vector: VEC98, cvss_score: 9.8 },
      { origin: "agent", severity: "medium", cvssScore: 4.0 },
      H,
      true,
    );
    expect(patch.severity).toBe("medium");
    expect(Object.keys(patch)).toContain("cvss_vector");
    expect(Object.keys(patch)).toContain("cvss_score");
    expect(patch.cvss_vector).toBeUndefined();
    expect(patch.cvss_score).toBeUndefined();
  });

  it("#B1b vetor novo INVÁLIDO + já há vetor armazenado → mantém o par armazenado (não grava lixo)", () => {
    const { patch, updatedFields } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high", cvss_vector: VEC98, cvss_score: 9.8 },
      { origin: "agent", severity: "high", cvssVector: "C:H/I:H" },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
    expect(patch).not.toHaveProperty("cvss_score");
    expect(updatedFields).toHaveLength(0);
  });

  it("vetor INVÁLIDO + score, sem vetor armazenado → NÃO grava o vetor-lixo; aceita o score", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high" },
      { origin: "agent", severity: "high", cvssVector: "lixo", cvssScore: 5.5 },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
    expect(patch.cvss_score).toBe(5.5);
  });

  it("score-only COM vetor armazenado (severidade igual) → ignora o score (não contradiz o vetor)", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high", cvss_vector: VEC98, cvss_score: 9.8 },
      { origin: "agent", severity: "high", cvssScore: 3.3 },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("cvss_score");
    expect(patch).not.toHaveProperty("cvss_vector");
  });

  it("severidade muda mas NÃO havia CVSS → nada a limpar", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "critical" },
      { origin: "agent", severity: "low" },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
    expect(patch).not.toHaveProperty("cvss_score");
  });

  it("mesmo vetor e severidade → não re-escreve (honesto)", () => {
    const { patch, updatedFields } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "critical", cvss_vector: VEC98, cvss_score: 9.8 },
      { origin: "agent", severity: "critical", cvssVector: VEC98 },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
    expect(patch).not.toHaveProperty("cvss_score");
    expect(updatedFields).toHaveLength(0);
  });
});

describe("computeMergePatch — vazio/espaço (#L2) [latestWins=true]", () => {
  it("narrativa só-espaço NÃO sobrescreve", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high", narrative: "real" },
      { origin: "agent", severity: "high", narrative: "   " },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("narrative");
  });

  it('steps só-vazios ["","  "] → ignora', () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high" },
      { origin: "agent", severity: "high", reproductionSteps: ["", "   "] },
      H,
      true,
    );
    expect(patch).not.toHaveProperty("reproduction_steps");
  });

  it("steps filtram vazios, mantêm reais", () => {
    const { patch } = computeMergePatch(
      { status: "draft", created_by: "agent", severity: "high" },
      { origin: "agent", severity: "high", reproductionSteps: ["a", "", "b"] },
      H,
      true,
    );
    expect(patch.reproduction_steps).toEqual(["a", "b"]);
  });
});

describe("computeMergePatch — conservador [latestWins=false] (preserva curadoria)", () => {
  it("NÃO sobrescreve severity/narrativa; só completa campo vazio", () => {
    const { patch } = computeMergePatch(
      { status: "in_review", created_by: "agent", severity: "medium", narrative: "curated" },
      { origin: "agent", severity: "critical", narrative: "new", description: "d" },
      H,
      false,
    );
    expect(patch).not.toHaveProperty("severity");
    expect(patch).not.toHaveProperty("narrative");
    expect(patch.description).toBe("d");
  });

  it("prev só-espaço é preenchido por novo não-vazio", () => {
    const { patch } = computeMergePatch(
      { status: "in_review", created_by: "agent", description: "   " },
      { origin: "agent", severity: "high", description: "real" },
      H,
      false,
    );
    expect(patch.description).toBe("real");
  });

  it("#1 conservador NUNCA preenche CVSS mesmo com vetor vazio (sem 9.8 ao lado de severidade preservada)", () => {
    const { patch } = computeMergePatch(
      { status: "in_review", created_by: "agent", severity: "low" },
      { origin: "agent", severity: "critical", cvssVector: VEC98 },
      H,
      false,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
    expect(patch).not.toHaveProperty("cvss_score");
    expect(patch).not.toHaveProperty("severity"); // severidade curada preservada
  });

  it("#1 conservador não preenche vetor sobre linha score-only (sem divergência)", () => {
    const { patch } = computeMergePatch(
      { status: "in_review", created_by: "agent", severity: "high", cvss_score: 9.8 },
      { origin: "agent", severity: "high", cvssVector: "AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N" },
      H,
      false,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
    expect(patch).not.toHaveProperty("cvss_score");
  });

  it("#1 conservador nunca grava vetor inválido (lixo)", () => {
    const { patch } = computeMergePatch(
      { status: "in_review", created_by: "agent", severity: "high" },
      { origin: "agent", severity: "high", cvssVector: "lixo" },
      H,
      false,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
  });

  it("#1 conservador PRESERVA vetor+score curados (não limpa o CVSS do analista)", () => {
    const { patch } = computeMergePatch(
      { status: "in_review", created_by: "agent", severity: "critical", cvss_vector: VEC98, cvss_score: 9.8 },
      { origin: "agent", severity: "low" },
      H,
      false,
    );
    expect(patch).not.toHaveProperty("cvss_vector");
    expect(patch).not.toHaveProperty("cvss_score");
    expect(patch).not.toHaveProperty("severity");
  });
});

describe("sameEvidenceContent — dedup por conteúdo (fix #3/#B2/#M1)", () => {
  describe("texto (http/note/command/tool_output)", () => {
    const base = { source_type: "http", snippet: "abc", label: "L1" };
    it("conteúdo+rótulo idênticos → dedup", () => {
      expect(sameEvidenceContent(base, { ...base })).toBe(true);
    });
    it("snippet diferente → anexa", () => {
      expect(sameEvidenceContent(base, { ...base, snippet: "XYZ" })).toBe(false);
    });
    it("#M1 rótulo diferente (mesmo snippet) → anexa", () => {
      expect(sameEvidenceContent(base, { ...base, label: "L2" })).toBe(false);
    });
    it("#M1 passo (step_index) diferente → anexa", () => {
      expect(
        sameEvidenceContent({ ...base, step_index: 1 }, { ...base, step_index: 2 }),
      ).toBe(false);
    });
    it("file_id NÃO entra na identidade de texto", () => {
      expect(
        sameEvidenceContent({ ...base, file_id: "fa" }, { ...base, file_id: "fb" }),
      ).toBe(true);
    });
    it("source_type diferente → anexa", () => {
      expect(sameEvidenceContent(base, { ...base, source_type: "note" })).toBe(false);
    });
  });

  describe("imagem/arquivo (source_type file) — #B2 rótulo+tipo+tamanho", () => {
    const img = {
      source_type: "file",
      label: "XSS PoC",
      media_type: "image/png",
      size: 5000,
    };
    it("mesmo rótulo+tipo+tamanho → dedup, mesmo com file_id/s3_key novos", () => {
      expect(
        sameEvidenceContent(
          { ...img, file_id: "fa", s3_key: "users/u/a.png" },
          { ...img, file_id: "fb", s3_key: "users/u/b.png" },
        ),
      ).toBe(true);
    });
    it("tamanho diferente (print corrigido) → anexa", () => {
      expect(sameEvidenceContent(img, { ...img, size: 5001 })).toBe(false);
    });
    it("rótulo diferente → anexa", () => {
      expect(sameEvidenceContent(img, { ...img, label: "Outra" })).toBe(false);
    });
    it("media_type diferente → anexa", () => {
      expect(sameEvidenceContent(img, { ...img, media_type: "image/jpeg" })).toBe(false);
    });
    it("snippet NÃO afeta identidade de arquivo", () => {
      expect(
        sameEvidenceContent({ ...img, snippet: "x" }, { ...img, snippet: "y" }),
      ).toBe(true);
    });
  });
});
