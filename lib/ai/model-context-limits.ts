// Janela de contexto real de modelos LOCAIS (menor que o padrao de 200k que o
// app assume p/ modelos pagos). O agente usa isso para disparar o resumo/pruning
// ANTES de estourar, evitando o erro "modelo indisponivel" (400 de contexto do
// vLLM). Ex.: cerberus = qwen3-coder-30B no vLLM com max-model-len 49152; o
// orcamento aqui e CONSERVADOR porque o prompt real inclui, fixo e nao-resumivel,
// o system prompt (~6k) + os schemas das ferramentas (~12k) alem do historico.
export const MODEL_CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  "model-suricatoos-cerberus": 20_000,
};

export const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "model-suricatoos-cerberus": 5_000,
};

/** Janela de contexto (tokens) de um modelo com limite menor que o padrao, ou undefined. */
export const getModelContextWindow = (
  modelName?: string,
): number | undefined =>
  modelName ? MODEL_CONTEXT_WINDOW_TOKENS[modelName] : undefined;

/** Teto de tokens de saida de um modelo com limite menor que o padrao, ou undefined. */
export const getModelMaxOutputTokens = (
  modelName?: string,
): number | undefined =>
  modelName ? MODEL_MAX_OUTPUT_TOKENS[modelName] : undefined;
