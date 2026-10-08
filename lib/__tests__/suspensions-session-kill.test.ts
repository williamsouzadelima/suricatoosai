jest.mock("server-only", () => ({}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: jest.fn(), mutation: jest.fn() }),
}));

import { shouldKillSessions } from "@/lib/suspensions";

describe("shouldKillSessions (gate do kill de sessão)", () => {
  it("mata sessão para categorias de SEGURANÇA/abuso", () => {
    expect(shouldKillSessions("admin_manual")).toBe(true);
    expect(shouldKillSessions("dispute_fraudulent")).toBe(true);
    expect(shouldKillSessions("support_confirmed_fraud")).toBe(true);
  });

  it("NÃO mata sessão para outras categorias (ex.: cobrança)", () => {
    expect(shouldKillSessions("billing_overdue")).toBe(false);
    expect(shouldKillSessions("trial_ended")).toBe(false);
    expect(shouldKillSessions("")).toBe(false);
    expect(shouldKillSessions("qualquer_outra")).toBe(false);
  });
});
