// Mocks das deps do módulo (não usadas pelos helpers de CIDR, mas o import roda).
jest.mock("next/server", () => ({
  NextResponse: { json: jest.fn() },
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: jest.fn(), mutation: jest.fn() }),
}));

import { parseCidr, ipInAnyCidr } from "@/lib/security/edge-guard";

const C = (s: string) => {
  const c = parseCidr(s);
  if (!c) throw new Error("cidr inválido no teste: " + s);
  return c;
};

describe("edge-guard — match de CIDR", () => {
  it("IPv4 /8, /24, /32", () => {
    expect(ipInAnyCidr("10.1.2.3", [C("10.0.0.0/8")])).toBe(true);
    expect(ipInAnyCidr("11.0.0.1", [C("10.0.0.0/8")])).toBe(false);
    expect(ipInAnyCidr("192.168.1.55", [C("192.168.1.0/24")])).toBe(true);
    expect(ipInAnyCidr("192.168.2.1", [C("192.168.1.0/24")])).toBe(false);
    expect(ipInAnyCidr("1.2.3.4", [C("1.2.3.4/32")])).toBe(true);
    expect(ipInAnyCidr("1.2.3.5", [C("1.2.3.4/32")])).toBe(false);
  });

  it("IPv6", () => {
    expect(ipInAnyCidr("2001:db8:1::1", [C("2001:db8::/32")])).toBe(true);
    expect(ipInAnyCidr("2001:db9::1", [C("2001:db8::/32")])).toBe(false);
    expect(ipInAnyCidr("fe80::1", [C("::/0")])).toBe(true);
  });

  it("família cruzada e entradas inválidas NÃO casam (fail-open)", () => {
    expect(ipInAnyCidr("1.2.3.4", [C("2001:db8::/32")])).toBe(false); // v4 x v6
    expect(ipInAnyCidr("2001:db8::1", [C("10.0.0.0/8")])).toBe(false); // v6 x v4
    expect(ipInAnyCidr("lixo", [C("10.0.0.0/8")])).toBe(false);
    expect(ipInAnyCidr("10.0.0.1", [])).toBe(false);
  });

  it("primeiro match em lista com múltiplos CIDRs", () => {
    const list = [C("172.16.0.0/12"), C("10.0.0.0/8")];
    expect(ipInAnyCidr("10.9.9.9", list)).toBe(true);
    expect(ipInAnyCidr("8.8.8.8", list)).toBe(false);
  });

  it("parseCidr rejeita inválidos", () => {
    expect(parseCidr("sembarra")).toBeNull();
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("10.0.0.0/-1")).toBeNull();
    expect(parseCidr("999.0.0.0/8")).toBeNull();
    expect(parseCidr("2001:db8::/129")).toBeNull();
  });
});
