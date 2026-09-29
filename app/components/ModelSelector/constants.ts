import type { ChatMode, SelectedModel } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";

export interface ModelOption {
  id: SelectedModel;
  label: string;
  /** Short tagline shown in the hover popup (e.g. "Maximum intelligence for complex work") */
  description?: string;
  /** "Powered by …" line shown beneath the description in the hover popup */
  poweredBy?: string;
  thinking?: boolean;
}

/**
 * Seletor do operador: modelos concretos (múltiplas opções) além do Auto.
 * ORDENADO do mais BARATO ao mais CARO (preço de saída $/M do OpenRouter) —
 * casa com o indicador $ / $$ / $$$ / $$$+ do CostIndicator. Cada `id` é uma
 * chave interna model-* que `selectModel` roteia diretamente.
 */
const OPERATOR_MODEL_OPTIONS: ModelOption[] = [
  {
    id: "model-glm-5.3-flash",
    label: "Z.ai GLM 5.3 Flash",
    description: "Rápido e muito econômico",
    poweredBy: "Z.ai · 1M contexto",
  },
  {
    id: "model-deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    description: "Econômico para tarefas simples",
    poweredBy: "DeepSeek",
  },
  {
    id: "model-deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    description: "Flash mais recente, rápido e barato",
    poweredBy: "DeepSeek · 1M contexto",
  },
  {
    id: "model-deepseek-v4-pro-0813",
    label: "DeepSeek V4 Pro",
    description: "Raciocínio profundo, contexto longo",
    poweredBy: "DeepSeek · 1M contexto",
  },
  {
    id: "model-glm-5.3",
    label: "Z.ai GLM 5.3",
    description: "Forte e econômico, contexto longo",
    poweredBy: "Z.ai · 1M contexto",
  },
  {
    id: "model-grok-4.6",
    label: "xAI Grok 4.6",
    description: "Agente forte, tool-calling robusto",
    poweredBy: "xAI · 500k contexto",
  },
  {
    id: "model-grok-4.7",
    label: "xAI Grok 4.7",
    description: "Grok mais recente da xAI",
    poweredBy: "xAI · 500k contexto",
  },
  {
    id: "model-kimi-k3",
    label: "Moonshot Kimi K3",
    description: "Raciocínio premium (mais caro)",
    poweredBy: "Moonshot",
  },
];

export const ASK_MODEL_OPTIONS: ModelOption[] = OPERATOR_MODEL_OPTIONS.map(
  (opt) => ({ ...opt }),
);

export const AGENT_MODEL_OPTIONS: ModelOption[] = OPERATOR_MODEL_OPTIONS.map(
  (opt) => ({ ...opt, thinking: true }),
);

export const getDefaultModelForMode = (mode: ChatMode): SelectedModel => {
  const options = isAgentMode(mode) ? AGENT_MODEL_OPTIONS : ASK_MODEL_OPTIONS;
  return options[0].id;
};
