import { describe, it, expect, jest } from "@jest/globals";
import type { Id } from "../_generated/dataModel";
import {
  requireOwnedDoc,
  getOwnedDoc,
  requireIdentity,
} from "../lib/tenantGuards";

/**
 * Verificação adversarial do guard de tenant. Um ctx falso (auth+db) exercita os
 * caminhos de posse: sem sessão, doc de outro tenant (IDOR), doc inexistente, e
 * dono legítimo. É o guardrail que garante que a checagem central realmente nega.
 */

const SUBJECT = "user_owner";
const OWNED = { _id: "d1", user_id: SUBJECT, name: "x" };
const FOREIGN = { _id: "d2", user_id: "user_attacker", name: "y" };
const ID = "d1" as Id<"findings">;

function makeCtx(identity: unknown, doc: unknown) {
  return {
    auth: { getUserIdentity: jest.fn(async () => identity) },
    db: { get: jest.fn(async () => doc) },
  } as never;
}

describe("tenantGuards.requireIdentity", () => {
  it("lança UNAUTHORIZED sem sessão", async () => {
    await expect(requireIdentity(makeCtx(null, null))).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
    });
  });
  it("retorna a identidade quando autenticado", async () => {
    const id = await requireIdentity(makeCtx({ subject: SUBJECT }, null));
    expect(id.subject).toBe(SUBJECT);
  });
});

describe("tenantGuards.requireOwnedDoc (lança)", () => {
  it("UNAUTHORIZED sem sessão — nem consulta o banco", async () => {
    const ctx = makeCtx(null, OWNED);
    await expect(requireOwnedDoc(ctx, ID)).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
    });
    expect((ctx as unknown as { db: { get: jest.Mock } }).db.get).not.toHaveBeenCalled();
  });
  it("ACCESS_DENIED quando o doc é de OUTRO tenant (IDOR)", async () => {
    await expect(
      requireOwnedDoc(makeCtx({ subject: SUBJECT }, FOREIGN), ID),
    ).rejects.toMatchObject({ data: { code: "ACCESS_DENIED" } });
  });
  it("ACCESS_DENIED quando o doc não existe", async () => {
    await expect(
      requireOwnedDoc(makeCtx({ subject: SUBJECT }, null), ID),
    ).rejects.toMatchObject({ data: { code: "ACCESS_DENIED" } });
  });
  it("retorna { subject, doc } para o dono legítimo", async () => {
    const r = await requireOwnedDoc(makeCtx({ subject: SUBJECT }, OWNED), ID);
    expect(r.subject).toBe(SUBJECT);
    expect(r.doc).toBe(OWNED);
  });
});

describe("tenantGuards.getOwnedDoc (nullable)", () => {
  it("null sem sessão", async () => {
    expect(await getOwnedDoc(makeCtx(null, OWNED), ID)).toBeNull();
  });
  it("null quando o doc é de OUTRO tenant (IDOR)", async () => {
    expect(await getOwnedDoc(makeCtx({ subject: SUBJECT }, FOREIGN), ID)).toBeNull();
  });
  it("null quando o doc não existe", async () => {
    expect(await getOwnedDoc(makeCtx({ subject: SUBJECT }, null), ID)).toBeNull();
  });
  it("retorna o doc para o dono legítimo", async () => {
    const r = await getOwnedDoc(makeCtx({ subject: SUBJECT }, OWNED), ID);
    expect(r?.doc).toBe(OWNED);
  });
});
