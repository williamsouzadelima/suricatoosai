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

import { generateText } from "ai";

import {
  createUnoRouterPatchFetch,
  createUnoRouterProvider,
} from "./unorouter-provider";

const URL = "https://api.unorouter.com/v1/chat/completions";

// Valor ORIGINAL do env — restaurado após cada teste p/ NÃO vazar
// UNOROUTER_API_KEY para outras suítes que compartilham o worker do jest.
const ORIGINAL_UNO_ENV = process.env.UNOROUTER_API_KEY;

beforeEach(() => {
  mockResolve.mockReset();
  mockExhausted.mockReset();
  mockAuthError.mockReset();
  mockInvalidate.mockReset();
  // Slate limpa: cada teste declara explicitamente se há env key (bootstrap/
  // fallback). Sem isto, um .env de CI poderia injetar a var e mascarar o teste.
  delete process.env.UNOROUTER_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_UNO_ENV === undefined) delete process.env.UNOROUTER_API_KEY;
  else process.env.UNOROUTER_API_KEY = ORIGINAL_UNO_ENV;
});

describe("createUnoRouterPatchFetch", () => {
  it("FAIL-CLOSED: sem pool E sem UNOROUTER_API_KEY, NÃO envia o request (não vaza placeholder/OPENAI_API_KEY)", async () => {
    // beforeEach já removeu UNOROUTER_API_KEY → sem pool E sem env = fail closed.
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

  it("ENV FALLBACK: sem chave de pool mas com UNOROUTER_API_KEY → usa a env key como Authorization (NÃO falha fechada)", async () => {
    process.env.UNOROUTER_API_KEY = "ENV-UNO-KEY";
    mockResolve.mockResolvedValue(null);
    const underlying = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const fetchImpl = createUnoRouterPatchFetch(
      underlying as unknown as typeof fetch,
    );
    const res = await fetchImpl(URL, {
      method: "POST",
      body: "{}",
      headers: { Authorization: "Bearer pool-managed-no-key" },
    });
    expect(res.status).toBe(200);
    expect(underlying).toHaveBeenCalledTimes(1);
    const sentInit = underlying.mock.calls[0][1] as RequestInit;
    expect(new Headers(sentInit.headers).get("Authorization")).toBe(
      "Bearer ENV-UNO-KEY",
    );
  });

  it("ENV TERMINAL: a env key é o último recurso — 402 nela NÃO rotaciona, devolve a resposta honesta", async () => {
    process.env.UNOROUTER_API_KEY = "ENV-UNO-KEY";
    mockResolve.mockResolvedValue(null);
    const underlying = jest
      .fn()
      .mockResolvedValue(new Response("no credit", { status: 402 }));
    const fetchImpl = createUnoRouterPatchFetch(
      underlying as unknown as typeof fetch,
    );
    const res = await fetchImpl(URL, { method: "POST", body: "{}" });
    expect(res.status).toBe(402);
    expect(underlying).toHaveBeenCalledTimes(1);
    expect(mockExhausted).not.toHaveBeenCalled();
  });

  it("POOL VENCE ENV: havendo chave de pool, usa a do pool mesmo com UNOROUTER_API_KEY setada", async () => {
    process.env.UNOROUTER_API_KEY = "ENV-UNO-KEY";
    mockResolve.mockResolvedValue({ id: "uno1", plaintext: "POOLKEY" });
    const underlying = jest
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const fetchImpl = createUnoRouterPatchFetch(
      underlying as unknown as typeof fetch,
    );
    await fetchImpl(URL, { method: "POST", body: "{}" });
    const sentInit = underlying.mock.calls[0][1] as RequestInit;
    expect(new Headers(sentInit.headers).get("Authorization")).toBe(
      "Bearer POOLKEY",
    );
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

  it("o provider roteia via /chat/completions (uno.chat), NÃO /v1/responses (default do SDK OpenAI)", async () => {
    // O callable default do @ai-sdk/openai (`uno(slug)`) vai p/ /v1/responses; o
    // "Testar" prova /chat/completions. buildProviderMap DEVE usar `uno.chat()`
    // p/ o endpoint de produção casar com o probe e ser OpenAI-compat padrão.
    mockResolve.mockResolvedValue({ id: "uno1", plaintext: "UNOKEY" });
    const chatOk = () =>
      new Response(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "gemma-4-31b-it:free",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const spy = jest.fn(() => Promise.resolve(chatOk()));
    const realFetch = global.fetch;
    (global as unknown as { fetch: typeof fetch }).fetch =
      spy as unknown as typeof fetch;
    try {
      await generateText({
        model: createUnoRouterProvider().chat("gemma-4-31b-it:free"),
        prompt: "ping",
      });
    } catch {
      // o formato da resposta não é o foco — a URL já foi capturada no spy
    } finally {
      (global as unknown as { fetch: typeof fetch }).fetch = realFetch;
    }
    const url = String(spy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/chat/completions");
    expect(url).not.toContain("/responses");
  });
});
