import { describe, it, expect } from "@jest/globals";
import { ASK_MODEL_OPTIONS, AGENT_MODEL_OPTIONS } from "../constants";
import { getCostTier } from "../CostIndicator";
import { myProvider, resolveTierToProviderKey } from "@/lib/ai/providers";
import type { ChatMode } from "@/types/chat";

/**
 * Drift guard: every selectable Suricatoos tier must resolve to a provider key
 * registered with `myProvider` in *both* modes. Without this, picking the
 * tier from the UI would crash on `myProvider.languageModel()`.
 */
describe("ModelSelector tier ↔ provider drift", () => {
  const allOptions = [...ASK_MODEL_OPTIONS, ...AGENT_MODEL_OPTIONS];

  it("every option in both lineups resolves to a registered provider", () => {
    for (const mode of ["ask", "agent"] as ChatMode[]) {
      const options =
        mode === "agent" ? AGENT_MODEL_OPTIONS : ASK_MODEL_OPTIONS;
      for (const option of options) {
        const providerKey = resolveTierToProviderKey(option.id, mode);
        expect(providerKey).not.toBeNull();
        expect(() =>
          myProvider.languageModel(providerKey as string),
        ).not.toThrow();
      }
    }
  });

  it("ask + agent lineups expose the same tier ids", () => {
    const askIds = new Set(ASK_MODEL_OPTIONS.map((o) => o.id));
    const agentIds = new Set(AGENT_MODEL_OPTIONS.map((o) => o.id));
    expect([...askIds].sort()).toEqual([...agentIds].sort());
  });

  it("Suricatoos Standard resolves to DeepSeek V4 Flash 0731 in both modes", () => {
    expect(resolveTierToProviderKey("hackerai-standard", "ask")).toBe(
      "model-deepseek-v4-flash-0731",
    );
    expect(resolveTierToProviderKey("hackerai-standard", "agent")).toBe(
      "model-deepseek-v4-flash-0731",
    );
  });

  it("Suricatoos Pro resolves to DeepSeek V4 Pro 0813 in both modes", () => {
    expect(resolveTierToProviderKey("hackerai-pro", "ask")).toBe(
      "model-deepseek-v4-pro-0813",
    );
    expect(resolveTierToProviderKey("hackerai-pro", "agent")).toBe(
      "model-deepseek-v4-pro-0813",
    );
  });

  it("Suricatoos Max resolves to the same provider in both modes", () => {
    expect(resolveTierToProviderKey("hackerai-max", "ask")).toBe(
      "model-grok-4.6",
    );
    expect(resolveTierToProviderKey("hackerai-max", "agent")).toBe(
      "model-grok-4.6",
    );
  });

  it("'auto' returns null (caller routes to the auto router)", () => {
    expect(resolveTierToProviderKey("auto", "ask")).toBeNull();
    expect(resolveTierToProviderKey("auto", "agent")).toBeNull();
  });

  it("hover-popup descriptions and provider disclosure present for every option", () => {
    expect(allOptions.length).toBeGreaterThan(0);
    for (const option of allOptions) {
      expect(option.description).toBeTruthy();
      expect(option.poweredBy).toBeTruthy();
    }
  });

  it("exposes the expected concrete operator models in both lineups", () => {
    const expected = [
      "model-grok-4.6",
      "model-grok-4.7",
      "model-glm-5.3",
      "model-glm-5.3-flash",
      "model-deepseek-v4-pro-0813",
      "model-deepseek-v4.1-flash",
      "model-deepseek-v4-flash-0731",
      "model-kimi-k3",
    ].sort();
    expect(ASK_MODEL_OPTIONS.map((o) => o.id).sort()).toEqual(expected);
    expect(AGENT_MODEL_OPTIONS.map((o) => o.id).sort()).toEqual(expected);
  });

  it("agent options carry the thinking flag; ask options do not", () => {
    expect(AGENT_MODEL_OPTIONS.every((o) => o.thinking === true)).toBe(true);
    expect(ASK_MODEL_OPTIONS.every((o) => !o.thinking)).toBe(true);
  });

  it("os modelos concretos cobrem múltiplas faixas de custo ($/$$/$$$)", () => {
    // Sem diferenciação (tudo "medium") era o bug: precisa haver espectro real.
    const tiers = new Set(AGENT_MODEL_OPTIONS.map((o) => getCostTier(o.id)));
    expect(tiers.size).toBeGreaterThanOrEqual(3);
    expect(getCostTier("model-glm-5.3-flash")).toBe("low"); // $
    expect(getCostTier("model-glm-5.3")).toBe("medium"); // $$
    expect(getCostTier("model-grok-4.7")).toBe("high"); // $$$
    expect(getCostTier("model-kimi-k3")).toBe("very-high"); // $$$+
  });

  it("resolves each concrete option to its own registered model key", () => {
    expect(resolveTierToProviderKey("model-grok-4.7", "agent")).toBe(
      "model-grok-4.7",
    );
    expect(resolveTierToProviderKey("model-deepseek-v4.1-flash", "ask")).toBe(
      "model-deepseek-v4.1-flash",
    );
  });
});
