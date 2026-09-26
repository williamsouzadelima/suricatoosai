import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import type { Id, Doc } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";

/**
 * Portal do cliente (read-only) — núcleo de AUTORIZAÇÃO. Todas as funções são
 * serviceKey (chamadas pelas rotas Node do portal, que resolvem a sessão WorkOS
 * e passam o userId). **Deny-by-default**: acesso do cliente exige
 * `client_memberships` ATIVA (role client_viewer) E `clients.portal_enabled`.
 * NUNCA autoriza por posse (report.user_id é o analista, não o cliente).
 * Ver [[suricatoosai-presenca-e-roadmap]], [[feelsec-client-side-authz-antipattern]].
 */

async function resolveMembership(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  clientId: Id<"clients">,
): Promise<{ client: Doc<"clients"> } | null> {
  const m = await ctx.db
    .query("client_memberships")
    .withIndex("by_user_and_client", (q) =>
      q.eq("user_id", userId).eq("client_id", clientId),
    )
    .first();
  if (!m || m.status !== "active") return null;
  const client = await ctx.db.get(clientId);
  if (!client || client.portal_enabled !== true) return null;
  return { client };
}

/** Clientes que este usuário pode ver no portal (memberships ativas + portal ligado). */
export const listPortalClientsForBackend = query({
  args: { serviceKey: v.string(), userId: v.string() },
  returns: v.array(v.object({ id: v.id("clients"), name: v.string() })),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const memberships = await ctx.db
      .query("client_memberships")
      .withIndex("by_user", (q) => q.eq("user_id", args.userId))
      .collect();
    const out: { id: Id<"clients">; name: string }[] = [];
    for (const m of memberships) {
      if (m.status !== "active") continue;
      const client = await ctx.db.get(m.client_id);
      if (client && client.portal_enabled === true) {
        out.push({ id: client._id, name: client.name });
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },
});

/** Engajamentos de um cliente que o usuário tem acesso (deny-by-default). */
export const listPortalEngagementsForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    clientId: v.id("clients"),
  },
  returns: v.array(
    v.object({
      id: v.id("engagements"),
      name: v.string(),
      code: v.union(v.string(), v.null()),
      status: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const access = await resolveMembership(ctx, args.userId, args.clientId);
    if (!access) return [];
    const engagements = await ctx.db
      .query("engagements")
      .withIndex("by_client_and_updated", (q) =>
        q.eq("client_id", args.clientId),
      )
      .order("desc")
      .collect();
    return engagements.map((e) => ({
      id: e._id,
      name: e.name,
      code: e.code ?? null,
      status: e.status,
      updatedAt: e.updated_at,
    }));
  },
});

/** Relatórios PRONTOS de um engajamento (re-resolve o cliente do engajamento). */
export const listPortalReportsForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    engagementId: v.id("engagements"),
  },
  returns: v.array(
    v.object({
      id: v.id("reports"),
      audience: v.string(),
      format: v.string(),
      version: v.number(),
      title: v.string(),
      reportGroupId: v.string(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const eng = await ctx.db.get(args.engagementId);
    if (!eng) return [];
    const access = await resolveMembership(ctx, args.userId, eng.client_id);
    if (!access) return [];
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_engagement", (q) =>
        q.eq("engagement_id", args.engagementId),
      )
      .order("desc")
      .collect();
    return reports
      .filter((r) => r.status === "ready")
      .map((r) => ({
        id: r._id,
        audience: r.audience,
        format: r.format,
        version: r.version,
        title: r.title,
        reportGroupId: r.report_group_id,
        createdAt: r.created_at,
      }));
  },
});

/**
 * Metadados para download PELO PORTAL — autoriza por MEMBERSHIP (nunca posse).
 * Re-resolve o client_id do próprio doc do relatório (à prova de IDOR pela URL).
 */
export const getPortalReportForDownloadForBackend = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    reportId: v.id("reports"),
  },
  returns: v.union(
    v.null(),
    v.object({
      s3Key: v.union(v.string(), v.null()),
      status: v.string(),
      format: v.string(),
      audience: v.string(),
      version: v.number(),
      title: v.string(),
      clientId: v.id("clients"),
      engagementId: v.id("engagements"),
      organizationId: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const r = await ctx.db.get(args.reportId);
    if (!r) return null;
    const access = await resolveMembership(ctx, args.userId, r.client_id);
    if (!access) return null;
    return {
      s3Key: r.s3_key ?? null,
      status: r.status,
      format: r.format,
      audience: r.audience,
      version: r.version,
      title: r.title,
      clientId: r.client_id,
      engagementId: r.engagement_id,
      organizationId: r.organization_id ?? null,
    };
  },
});

// ── Grant / revoke (chamado pelas rotas admin com getSuperadminUser) ─────────

/** Concede acesso de portal (upsert membership ativa). serviceKey. */
export const grantPortalAccessForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    clientId: v.id("clients"),
    grantedBy: v.optional(v.string()),
  },
  returns: v.object({ ok: v.boolean(), clientName: v.string() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const client = await ctx.db.get(args.clientId);
    if (!client) {
      throw new Error("Cliente inexistente");
    }
    const now = Date.now();
    // Conceder acesso implica habilitar o portal para o cliente.
    if (client.portal_enabled !== true) {
      await ctx.db.patch(client._id, {
        portal_enabled: true,
        updated_at: now,
      });
    }
    const existing = await ctx.db
      .query("client_memberships")
      .withIndex("by_user_and_client", (q) =>
        q.eq("user_id", args.userId).eq("client_id", args.clientId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        granted_by: args.grantedBy,
        updated_at: now,
      });
    } else {
      await ctx.db.insert("client_memberships", {
        user_id: args.userId,
        client_id: args.clientId,
        organization_id: client.organization_id,
        role: "client_viewer",
        status: "active",
        granted_by: args.grantedBy,
        created_at: now,
        updated_at: now,
      });
    }
    return { ok: true, clientName: client.name };
  },
});

/** Revoga acesso de portal. serviceKey. */
export const revokePortalAccessForBackend = mutation({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    clientId: v.id("clients"),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const existing = await ctx.db
      .query("client_memberships")
      .withIndex("by_user_and_client", (q) =>
        q.eq("user_id", args.userId).eq("client_id", args.clientId),
      )
      .first();
    if (existing && existing.status !== "revoked") {
      await ctx.db.patch(existing._id, {
        status: "revoked",
        updated_at: Date.now(),
      });
    }
    return { ok: true };
  },
});

/** Lista memberships de um cliente (para a tela admin). serviceKey. */
export const listMembershipsForClientForBackend = query({
  args: { serviceKey: v.string(), clientId: v.id("clients") },
  returns: v.array(
    v.object({
      userId: v.string(),
      status: v.string(),
      grantedBy: v.union(v.string(), v.null()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    const rows = await ctx.db
      .query("client_memberships")
      .withIndex("by_client", (q) => q.eq("client_id", args.clientId))
      .collect();
    return rows.map((m) => ({
      userId: m.user_id,
      status: m.status,
      grantedBy: m.granted_by ?? null,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));
  },
});
