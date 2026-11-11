import type { ChatMode, SelectedModel } from "@/types/chat";
import { isAgentVerifiedFreeModel } from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";

export interface ModelOption {
  id: SelectedModel;
  label: string;
  /** Short tagline shown in the hover popup (e.g. "Maximum intelligence for complex work") */
  description?: string;
  /** "Powered by …" line shown beneath the description in the hover popup */
  poweredBy?: string;
  thinking?: boolean;
  /** Modelo GRATUITO ($0) — o provedor pode treinar com o prompt. Grupo separado
   *  na UI, bloqueado em chats de engajamento/cliente. */
  free?: boolean;
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
  // SEMPRE um PAGO (options[0] = pago mais barato). Free jamais é default —
  // por isso os free vivem em FREE_MODEL_OPTIONS, fora desta lista.
  const options = isAgentMode(mode) ? AGENT_MODEL_OPTIONS : ASK_MODEL_OPTIONS;
  return options[0].id;
};

/**
 * Modelos GRATUITOS ($0, servidos pelo UNOROUTER) — grupo SEPARADO no seletor,
 * depois dos pagos, com selo de política de dados. O provedor pode TREINAR com o
 * prompt → o servidor bloqueia em chats com engajamento/cliente (a UI só cinza).
 * Ordem: do maior/mais capaz ao menor (custo é igual: zero).
 */
const FREE_MODEL_OPTIONS_BASE: ModelOption[] = [
  {
    id: "model-nemotron-3-ultra-free",
    label: "NVIDIA Nemotron 3 Ultra",
    description: "Gratuito · 550B MoE, o maior dos free",
    poweredBy: "NVIDIA · via UnoRouter · pode treinar com o prompt",
    free: true,
  },
  {
    id: "model-nemotron-3-super-free",
    label: "NVIDIA Nemotron 3 Super",
    description: "Gratuito · 120B, equilíbrio entre força e velocidade",
    poweredBy: "NVIDIA · via UnoRouter · pode treinar com o prompt",
    free: true,
  },
  {
    id: "model-qwen3.8-27b-free",
    label: "Qwen 3.8 27B",
    description: "Gratuito · tool-calling sólido",
    poweredBy: "Alibaba Qwen · via UnoRouter · pode treinar com o prompt",
    free: true,
  },
  {
    id: "model-gemma-4-31b-free",
    label: "Google Gemma 4 31B",
    description: "Gratuito · modelo aberto do Google",
    poweredBy: "Google · via UnoRouter · pode treinar com o prompt",
    free: true,
  },
];

// B3: os free são servidos via UnoRouter (API OpenAI-compat), que IGNORA o bloco
// de reasoning do OpenRouter (providerOptions.openrouter). Não anunciamos
// "thinking" p/ não mentir sobre uma capacidade que o provedor pode não honrar.
//
// No AGENTE o modelo PRECISA fazer tool-calling (senão narra/alucina em vez de
// agir) → filtra aos free VERIFICADOS ao vivo (AGENT_VERIFIED_FREE_MODELS, H2).
// Ask TAMBÉM tem tools (notas/busca, condicionais — ver lib/ai/tools/index.ts),
// mas NÃO é tool-CÊNTRICO → mantém os 4 free. ⚠️ Risco residual: um free não-
// verificado narra num pedido de nota/busca em ask (decisão aberta: filtrar
// ask-com-tools ou aceitar). A guarda do servidor é o backstop do AGENTE.
export const getFreeModelOptions = (mode: ChatMode): ModelOption[] =>
  FREE_MODEL_OPTIONS_BASE.filter(
    (opt) => !isAgentMode(mode) || isAgentVerifiedFreeModel(opt.id),
  ).map((opt) => ({ ...opt }));
