import { describe, it, expect } from "@jest/globals";
import {
  initAgentStreamState,
  takeToolStatsDelta,
} from "../agent-stream-runner";

/**
 * Fase B — o delta guard garante que cada save de mensagem persista SÓ o
 * incremento de tool-calls/erros desde o último save (evita dupla-contagem
 * quando um run salva a mesma/mais de uma mensagem).
 */
describe("takeToolStatsDelta", () => {
  const state = () =>
    initAgentStreamState([], { usedTokens: 0, maxTokens: 100 });

  it("retorna o cumulativo no primeiro save", () => {
    const s = state();
    s.toolCallCount = 5;
    s.toolErrorCount = 1;
    expect(takeToolStatsDelta(s)).toEqual({ toolCalls: 5, toolErrorCount: 1 });
  });

  it("retorna 0 num save subsequente sem novas tools (sem dupla-contagem)", () => {
    const s = state();
    s.toolCallCount = 5;
    s.toolErrorCount = 1;
    takeToolStatsDelta(s);
    expect(takeToolStatsDelta(s)).toEqual({ toolCalls: 0, toolErrorCount: 0 });
  });

  it("retorna só o NOVO incremento quando mais tools rodam entre saves", () => {
    const s = state();
    s.toolCallCount = 5;
    s.toolErrorCount = 1;
    takeToolStatsDelta(s); // consome 5/1
    s.toolCallCount = 8; // +3
    s.toolErrorCount = 2; // +1
    expect(takeToolStatsDelta(s)).toEqual({ toolCalls: 3, toolErrorCount: 1 });
  });

  it("nunca retorna negativo (guarda defensiva)", () => {
    const s = state();
    s.toolStatsReportedCalls = 10; // reported > count (não deveria ocorrer)
    s.toolStatsReportedErrors = 3;
    s.toolCallCount = 4;
    s.toolErrorCount = 1;
    expect(takeToolStatsDelta(s)).toEqual({ toolCalls: 0, toolErrorCount: 0 });
  });
});
