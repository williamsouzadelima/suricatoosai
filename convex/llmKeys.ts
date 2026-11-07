import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { pickActiveKey } from "./lib/llmKeySelect";

/**
 * Pool de chaves de API de LLM (OpenRouter) com failover por crédito.
 *
 * Tudo serviceKey-gated (chamado pelas rotas /api/admin e pelo hook de saída do
 * provider, ambos no servidor Next). O plaintext da chave é cifrado FORA do
 * Convex (lib/llm-keys/crypto.ts, Node) e aqui só trafega/armazena cifrado:
 * listKeys NUNCA devolve ciphertext; getNextActiveKey devolve o material cifrado
 * só para o servidor decifrar (nunca chega ao cliente).
 */

const statusArg = v.union(
  v.literal("untested"),
  v.literal("active"),
  v.literal("exhausted"),
  v.literal("error"),
);

export const listKeysForBackend = query({
  args: { serviceKey: v.string() },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db.query("llm_api_keys").collect();
    rows.sort((a, b) => a.priority - b.priority || a.created_at - b.created_at);
    return rows.map((k) => ({
      id: k._id,
      label: k.label,
      provider: k.provider,
      last4: k.last4,
      enabled: k.enabled,
      priority: k.priority,
      status: k.status,
      exhaustedAt: k.exhausted_at ?? null,
      lastUsedAt: k.last_used_at ?? null,
      lastError: k.last_error ?? null,
      createdAt: k.created_at,
      updatedAt: k.updated_at,
    }));
  },
});

export const createKeyForBackend = mutation({
  args: {
    serviceKey: v.string(),
    label: v.string(),
    provider: v.string(),
    ciphertext: v.string(),
    iv: v.string(),
    authTag: v.string(),
    last4: v.string(),
    priority: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const now = Date.now();
    const id = await ctx.db.insert("llm_api_keys", {
      label: args.label,
      provider: args.provider,
      ciphertext: args.ciphertext,
      iv: args.iv,
      auth_tag: args.authTag,
      last4: args.last4,
      enabled: true,
      priority: args.priority ?? 100,
      status: "untested",
      created_by: args.createdBy,
      created_at: now,
      updated_at: now,
    });
    return { id };
  },
});

export const updateKeyForBackend = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("llm_api_keys"),
    label: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chave não encontrada" });
    }
    const patch: Record<string, unknown> = { updated_at: Date.now() };
    if (args.label !== undefined) patch.label = args.label;
    if (args.enabled !== undefined) patch.enabled = args.enabled;
    if (args.priority !== undefined) patch.priority = args.priority;
    await ctx.db.patch(args.id, patch);
    return null;
  },
});

export const setKeyStatusForBackend = mutation({
  args: {
    serviceKey: v.string(),
    id: v.id("llm_api_keys"),
    status: statusArg,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chave não encontrada" });
    }
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status: args.status,
      exhausted_at: args.status === "exhausted" ? now : undefined,
      last_error: args.error,
      updated_at: now,
    });
    return null;
  },
});

export const deleteKeyForBackend = mutation({
  args: { serviceKey: v.string(), id: v.id("llm_api_keys") },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    await ctx.db.delete(args.id);
    return null;
  },
});

/**
 * Próxima chave ATIVA do pool, COM o material cifrado, para o hook de saída
 * decifrar em Node. serviceKey-gated; o ciphertext vai só ao servidor, nunca ao
 * cliente. `excludeIds` pula chaves que já falharam nesta rodada de failover.
 */
export const getNextActiveKeyForBackend = query({
  args: {
    serviceKey: v.string(),
    excludeIds: v.optional(v.array(v.id("llm_api_keys"))),
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db.query("llm_api_keys").collect();
    const chosen = pickActiveKey(
      rows.map((k) => ({
        _id: k._id as string,
        enabled: k.enabled,
        priority: k.priority,
        status: k.status,
        created_at: k.created_at,
      })),
      { excludeIds: (args.excludeIds ?? []).map((i) => i as string) },
    );
    if (!chosen) return null;
    const row = rows.find((r) => (r._id as string) === chosen._id);
    if (!row) return null;
    return {
      id: row._id,
      label: row.label,
      last4: row.last4,
      provider: row.provider,
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
    };
  },
});

/** Marca uso bem-sucedido (vira "active" + last_used_at). Chamado após sucesso. */
export const markKeyUsedForBackend = mutation({
  args: { serviceKey: v.string(), id: v.id("llm_api_keys") },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const row = await ctx.db.get(args.id);
    if (!row) return null;
    const now = Date.now();
    await ctx.db.patch(args.id, {
      status:
        row.status === "exhausted" || row.status === "error"
          ? row.status
          : "active",
      last_used_at: now,
      updated_at: now,
    });
    return null;
  },
});
