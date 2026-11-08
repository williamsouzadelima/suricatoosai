import { cvssBaseScore } from "./cvss";

describe("cvssBaseScore (canônico em convex/lib)", () => {
  it("vetor oficial de referência → 9.8", () => {
    expect(cvssBaseScore("AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
  });
  it("scope changed sobe o peso (ex. 10.0)", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H")).toBe(10.0);
  });
  it("prefixo CVSS:3.1 é tolerado", () => {
    expect(cvssBaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
  });
  it("vetor vazio/nulo → null", () => {
    expect(cvssBaseScore(undefined)).toBeNull();
    expect(cvssBaseScore(null)).toBeNull();
    expect(cvssBaseScore("")).toBeNull();
  });
  it("vetor inválido → null", () => {
    expect(cvssBaseScore("lixo")).toBeNull();
    expect(cvssBaseScore("AV:X/AC:L")).toBeNull();
  });
  it("sem impacto (C/I/A none) → 0", () => {
    expect(cvssBaseScore("AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N")).toBe(0);
  });
});
