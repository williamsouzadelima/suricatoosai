import {
  evaluateApprovalGate,
  isImageEvidence,
  requireGraphicalEvidenceEnabled,
} from "./graphicalEvidence";

describe("isImageEvidence", () => {
  it("true p/ arquivo + media_type image/*", () => {
    expect(isImageEvidence({ file_id: "f1", media_type: "image/png" })).toBe(true);
    expect(isImageEvidence({ s3_key: "k", media_type: "image/gif" })).toBe(true);
  });
  it("false sem arquivo/objeto", () => {
    expect(isImageEvidence({ media_type: "image/png" })).toBe(false);
  });
  it("false se não é image/*", () => {
    expect(isImageEvidence({ file_id: "f1", media_type: "text/plain" })).toBe(false);
    expect(isImageEvidence({ s3_key: "k" })).toBe(false);
    expect(isImageEvidence({ file_id: "f1", media_type: null })).toBe(false);
  });
});

describe("requireGraphicalEvidenceEnabled", () => {
  const prev = process.env.REQUIRE_GRAPHICAL_EVIDENCE;
  afterEach(() => {
    if (prev === undefined) delete process.env.REQUIRE_GRAPHICAL_EVIDENCE;
    else process.env.REQUIRE_GRAPHICAL_EVIDENCE = prev;
  });
  it("off por default (zero retrocesso)", () => {
    delete process.env.REQUIRE_GRAPHICAL_EVIDENCE;
    expect(requireGraphicalEvidenceEnabled()).toBe(false);
    process.env.REQUIRE_GRAPHICAL_EVIDENCE = "false";
    expect(requireGraphicalEvidenceEnabled()).toBe(false);
  });
  it("on só com 'true' exato", () => {
    process.env.REQUIRE_GRAPHICAL_EVIDENCE = "true";
    expect(requireGraphicalEvidenceEnabled()).toBe(true);
  });
});

describe("evaluateApprovalGate", () => {
  const img = { file_id: "f1", media_type: "image/png" };
  const txt = { source_type: "note", media_type: "text/plain" };

  it("sem evidência → NO_EVIDENCE (independe da política)", () => {
    expect(evaluateApprovalGate({ graphicalRequired: false, evidences: [] })).toEqual({
      ok: false,
      code: "NO_EVIDENCE",
    });
    expect(evaluateApprovalGate({ graphicalRequired: true, evidences: [] })).toEqual({
      ok: false,
      code: "NO_EVIDENCE",
    });
  });

  it("política OFF: qualquer evidência basta (comportamento de hoje)", () => {
    expect(
      evaluateApprovalGate({ graphicalRequired: false, evidences: [txt] }),
    ).toEqual({ ok: true });
  });

  it("política ON: só texto → NO_GRAPHICAL_EVIDENCE", () => {
    expect(
      evaluateApprovalGate({ graphicalRequired: true, evidences: [txt] }),
    ).toEqual({ ok: false, code: "NO_GRAPHICAL_EVIDENCE" });
  });

  it("política ON: tem imagem → ok", () => {
    expect(
      evaluateApprovalGate({ graphicalRequired: true, evidences: [txt, img] }),
    ).toEqual({ ok: true });
  });
});
