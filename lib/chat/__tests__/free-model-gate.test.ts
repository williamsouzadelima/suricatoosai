import { describe, it, expect, jest } from "@jest/globals";
import {
  enforceFreeModelEngagementGate,
  assertFreeModelStillAllowed,
  FreeModelEngagementViolationError,
} from "../free-model-gate";

const silent = { warn: jest.fn() };
const FREE = "model-qwen3.8-27b-free" as const;

/**
 * Portão duro dos modelos GRATUITOS (podem treinar com o prompt): só chats SEM
 * engajamento/cliente. Servidor decide; falha de leitura é FAIL-CLOSED.
 */
describe("enforceFreeModelEngagementGate", () => {
  it("seleção NÃO-free passa direto e NÃO consulta o chat (custo zero)", async () => {
    const lookup = jest.fn(async () => ({ engagement_id: "eng_1" }));
    const r = await enforceFreeModelEngagementGate({
      selectedModelOverride: "model-grok-4.7",
      chatId: "c1",
      lookupChat: lookup,
      log: silent,
    });
    expect(r).toEqual({ override: "model-grok-4.7", blockedByEngagement: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("'auto'/undefined passam direto sem consulta", async () => {
    const lookup = jest.fn(async () => ({ engagement_id: "eng_1" }));
    for (const sel of ["auto", undefined] as const) {
      const r = await enforceFreeModelEngagementGate({
        selectedModelOverride: sel,
        chatId: "c1",
        lookupChat: lookup,
        log: silent,
      });
      expect(r.override).toBe(sel);
      expect(r.blockedByEngagement).toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("free sem chatId passa direto (nada a consultar)", async () => {
    const lookup = jest.fn(async () => null);
    const r = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: undefined,
      lookupChat: lookup,
      log: silent,
    });
    expect(r).toEqual({ override: FREE, blockedByEngagement: false });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("free em chat COM engajamento → rebaixa p/ 'auto' (BLOQUEADO)", async () => {
    const lookup = jest.fn(async () => ({ engagement_id: "eng_1" }));
    const r = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: "c1",
      lookupChat: lookup,
      log: silent,
    });
    expect(r.override).toBe("auto");
    expect(r.blockedByEngagement).toBe(true);
    expect(r.reason).toBe("engagement");
    expect(lookup).toHaveBeenCalledWith({ id: "c1" });
  });

  it("free em chat SEM engajamento → mantém o free", async () => {
    const lookup = jest.fn(async () => ({}));
    const r = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: "c1",
      lookupChat: lookup,
      log: silent,
    });
    expect(r).toEqual({ override: FREE, blockedByEngagement: false });
  });

  it("free em chat inexistente (novo, sem registro) → mantém o free", async () => {
    const lookup = jest.fn(async () => null);
    const r = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: "novo",
      lookupChat: lookup,
      log: silent,
    });
    expect(r).toEqual({ override: FREE, blockedByEngagement: false });
  });

  it("falha na leitura do chat → FAIL-CLOSED: rebaixa p/ 'auto'", async () => {
    const lookup = jest.fn(async () => {
      throw new Error("convex down");
    });
    const warn = jest.fn();
    const r = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: "c1",
      lookupChat: lookup,
      log: { warn },
    });
    expect(r.override).toBe("auto");
    expect(r.blockedByEngagement).toBe(true);
    expect(r.reason).toBe("lookup_failed");
    expect(warn).toHaveBeenCalled();
  });

  it("usa o chat JÁ carregado sem consultar: bound → auto; sem engajamento → free", async () => {
    const lookup = jest.fn(async () => ({ engagement_id: "eng_1" }));
    const bound = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: "c1",
      chat: { engagement_id: "eng_1" },
      lookupChat: lookup,
      log: silent,
    });
    expect(bound.override).toBe("auto");
    expect(bound.reason).toBe("engagement");
    const unbound = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: "c1",
      chat: {},
      lookupChat: lookup,
      log: silent,
    });
    expect(unbound).toEqual({ override: FREE, blockedByEngagement: false });
    // chat: null = chat NOVO conhecido → free permitido, sem consulta
    const fresh = await enforceFreeModelEngagementGate({
      selectedModelOverride: FREE,
      chatId: "novo",
      chat: null,
      lookupChat: lookup,
      log: silent,
    });
    expect(fresh).toEqual({ override: FREE, blockedByEngagement: false });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("assertFreeModelStillAllowed (re-checagem mid-run)", () => {
  it("não-free: no-op sem consulta", async () => {
    const lookup = jest.fn(async () => ({ engagement_id: "eng_1" }));
    await expect(
      assertFreeModelStillAllowed({
        selectedModelOverride: "model-grok-4.7",
        chatId: "c1",
        lookupChat: lookup,
      }),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("free e chat AGORA com engajamento → lança (aborta o run)", async () => {
    const lookup = jest.fn(async () => ({ engagement_id: "eng_1" }));
    await expect(
      assertFreeModelStillAllowed({
        selectedModelOverride: FREE,
        chatId: "c1",
        lookupChat: lookup,
      }),
    ).rejects.toBeInstanceOf(FreeModelEngagementViolationError);
  });

  it("free e chat segue sem engajamento → segue", async () => {
    const lookup = jest.fn(async () => ({}));
    await expect(
      assertFreeModelStillAllowed({
        selectedModelOverride: FREE,
        chatId: "c1",
        lookupChat: lookup,
      }),
    ).resolves.toBeUndefined();
  });

  it("free e leitura falha → FAIL-CLOSED (lança)", async () => {
    const lookup = jest.fn(async () => {
      throw new Error("convex down");
    });
    await expect(
      assertFreeModelStillAllowed({
        selectedModelOverride: FREE,
        chatId: "c1",
        lookupChat: lookup,
      }),
    ).rejects.toBeInstanceOf(FreeModelEngagementViolationError);
  });
});
