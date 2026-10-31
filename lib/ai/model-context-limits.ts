// Janela de contexto real de modelos LOCAIS (menor que o padrao de 200k que o
// app assume p/ modelos pagos). O budget/compactacao do agente usa estes limites
// para resumir/prunar ANTES de estourar, deixando a auto-continuacao do app flui
// sem erro "modelo indisponivel" nem botao Continue/Retry.
// Ex.: cerberus = qwen3-coder-30B no vLLM com max-model-len 49152. O budget e
// CONSERVADOR (deixa folga p/ a saida e p/ erro de estimativa): 40k de contexto
// total + 4k de saida cabem com margem dentro dos 49152 reais.
export const MODEL_CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  "model-suricatoos-cerberus": 40_000,
};

export const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "model-suricatoos-cerberus": 4_000,
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
