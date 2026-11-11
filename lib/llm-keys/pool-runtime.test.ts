/**
 * Isolamento de provider no runtime do pool (B2). A regra crítica: uma chave de
 * UM provider (OpenRouter) NUNCA pode ser servida a um resolve de OUTRO provider
 * (UnoRouter) — nem direto nem via cache — senão `Authorization: Bearer sk-or-…`
 * vaza para `api.unorouter.com` e o 401 resultante envenena o pool OpenRouter.
 */

jest.mock("@/convex/_generated/api", () => ({
  api: { llmKeys: { getNextActiveKeyForBackend: "getNextActiveKeyForBackend" } },
}));

const mockQuery = jest.fn();
const mockMutation = jest.fn().mockResolvedValue(null);
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery, mutation: mockMutation }),
}));

jest.mock("./crypto", () => ({
  decryptSecret: () => "DECRYPTED",
}));

import { resolveActivePoolKey, invalidatePoolKeyCache } from "./pool-runtime";

const row = (id: string, provider: string) => ({
  id,
  label: id,
  last4: id.slice(-4),
  provider,
  ciphertext: "c",
  iv: "i",
  authTag: "t",
});

beforeAll(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "svc-test";
  process.env.LLM_KEY_ENC_SECRET = "enc-secret-test";
});

beforeEach(() => {
  mockQuery.mockReset();
  invalidatePoolKeyCache();
});

describe("resolveActivePoolKey — isolamento de provider", () => {
  it("chave OpenRouter cacheada NUNCA é servida a um resolve UnoRouter", async () => {
    mockQuery.mockImplementation((_ref: unknown, args: { provider: string }) =>
      Promise.resolve(
        args.provider === "unorouter"
          ? row("uno1", "unorouter")
          : row("or1", "openrouter"),
      ),
    );

    const or = await resolveActivePoolKey([], "openrouter");
    expect(or?.id).toBe("or1");

    // Slot de cache único (bug B2) devolveria "or1" aqui. Cache por provider → "uno1".
    const uno = await resolveActivePoolKey([], "unorouter");
    expect(uno?.id).toBe("uno1");

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: "unorouter" }),
    );
  });

  it("sem provider = openrouter (back-compat)", async () => {
    mockQuery.mockResolvedValue(row("or1", "openrouter"));
    await resolveActivePoolKey([]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ provider: "openrouter" }),
    );
  });
});
