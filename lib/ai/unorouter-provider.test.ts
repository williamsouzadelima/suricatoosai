/**
 * @jest-environment node
 *
 * UnoRouter provider (free). Segurança crítica:
 * - B1: sem chave de pool UnoRouter, FALHA FECHADA — nunca envia o request (senão
 *   o placeholder, ou pior o OPENAI_API_KEY que o SDK OpenAI leria, vazaria p/
 *   api.unorouter.com).
 * - a Authorization enviada é SEMPRE a chave do pool, nunca o placeholder.
 * - failover: 402→esgotada, 401→erro, rotaciona por prioridade.
 */

const mockResolve = jest.fn();
const mockExhausted = jest.fn().mockResolvedValue(undefined);
const mockAuthError = jest.fn().mockResolvedValue(undefined);
const mockInvalidate = jest.fn();
jest.mock("@/lib/llm-keys/pool-runtime", () => ({
  resolveActivePoolKey: (...args: unknown[]) => mockResolve(...args),
  markPoolKeyExhausted: (...args: unknown[]) => mockExhausted(...args),
  markPoolKeyAuthError: (...args: unknown[]) => mockAuthError(...args),
  invalidatePoolKeyCache: (...args: unknown[]) => mockInvalidate(...args),
}));

import { createUnoRouterPatchFetch } from "./unorouter-provider";

const URL = "https://api.unorouter.com/v1/chat/completions";

beforeEach(() => {
  mockResolve.mockReset();
  mockExhausted.mockReset();
  mockAuthError.mockReset();
});

describe("createUnoRouterPatchFetch", () => {
  it("FAIL-CLOSED: sem chave de pool, NÃO envia o request (não vaza placeholder/OPENAI_API_KEY)", async () => {
    mockResolve.mockResolvedValue(null);
    const underlying = jest.fn();
    const fetchImpl = createUnoRouterPatchFetch(
      underlying as unknown as typeof fetch,
    );
    const res = await fetchImpl(URL, { method: "POST", body: "{}" });
    expect(underlying).not.toHaveBeenCalled();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockResolve).toHaveBeenCalledWith(expect.any(Array), "unorouter");
  });

  it("injeta a chave do pool como Authorization (nunca o placeholder)", async () => {
    mockResolve.mockResolvedValue({ id: "uno1", plaintext: "UNOKEY" });
    const underlying = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const fetchImpl = createUnoRouterPatchFetch(
      underlying as unknown as typeof fetch,
    );
    await fetchImpl(URL, {
      method: "POST",
      body: "{}",
      headers: { Authorization: "Bearer pool-managed-placeholder" },
    });
    const sentInit = underlying.mock.calls[0][1] as RequestInit;
    expect(new Headers(sentInit.headers).get("Authorization")).toBe(
      "Bearer UNOKEY",
    );
  });

  it("402 marca esgotada e rotaciona; sucesso encerra", async () => {
    mockResolve
      .mockResolvedValueOnce({ id: "uno1", plaintext: "K1" })
      .mockResolvedValueOnce({ id: "uno2", plaintext: "K2" });
    const underlying = jest
      .fn()
      .mockResolvedValueOnce(new Response("no credit", { status: 402 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const fetchImpl = createUnoRouterPatchFetch(
      underlying as unknown as typeof fetch,
    );
    const res = await fetchImpl(URL, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
    expect(mockExhausted).toHaveBeenCalledWith("uno1");
    expect(underlying).toHaveBeenCalledTimes(2);
  });
});
