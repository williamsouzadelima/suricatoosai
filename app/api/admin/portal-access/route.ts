import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { workos } from "@/app/api/workos";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gestão de acesso do cliente ao portal (grant/revoke de client_memberships).
// Só superadmin. Cada ação é auditada (membership.granted/revoked).

export async function GET(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) {
    return NextResponse.json({ error: "clientId ausente" }, { status: 400 });
  }
  const rows = await getConvexClient().query(
    api.portal.listMembershipsForClientForBackend,
    { serviceKey, clientId: clientId as Id<"clients"> },
  );
  const members = await Promise.all(
    rows.map(async (m) => {
      let email = m.userId;
      try {
        const wu = await workos.userManagement.getUser(m.userId);
        if (wu?.email) email = wu.email;
      } catch {
        // usuário some do WorkOS → cai no id
      }
      return { ...m, email };
    }),
  );
  return NextResponse.json({ members });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;
  const email = (body.email as string | undefined)?.trim().toLowerCase();
  if (!clientId || !email || !email.includes("@")) {
    return NextResponse.json(
      { error: "Informe cliente e e-mail válido." },
      { status: 400 },
    );
  }

  const found = await workos.userManagement.listUsers({ email, limit: 1 });
  const wu = found.data[0];
  if (!wu) {
    // Sem conta ainda → convida; a membership é concedida depois do cadastro.
    try {
      await workos.userManagement.sendInvitation({ email });
    } catch (e) {
      console.error("portal-access: falha ao enviar convite", e);
    }
    return NextResponse.json({
      status: "invited",
      message:
        "Convite enviado. Conceda o acesso novamente após o cliente criar a conta.",
    });
  }

  const convex = getConvexClient();
  const grant = await convex.mutation(api.portal.grantPortalAccessForBackend, {
    serviceKey,
    userId: wu.id,
    clientId: clientId as Id<"clients">,
    grantedBy: admin.email ?? admin.id,
  });
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: "membership.granted",
      actorUserId: admin.id,
      actorEmail: admin.email ?? undefined,
      actorKind: "internal",
      clientId: clientId as Id<"clients">,
      targetType: "user",
      targetId: wu.id,
      outcome: "success",
      detail: `portal grant ${email}`,
    });
  } catch (e) {
    console.error("portal-access: falha ao auditar grant", e);
  }
  if (grant.portalJustEnabled) {
    try {
      await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
        serviceKey,
        eventType: "portal.enabled",
        actorUserId: admin.id,
        actorEmail: admin.email ?? undefined,
        actorKind: "internal",
        clientId: clientId as Id<"clients">,
        targetType: "client",
        targetId: clientId,
        outcome: "success",
        detail: "portal auto-habilitado no 1º acesso",
      });
    } catch (e) {
      console.error("portal-access: falha ao auditar portal.enabled", e);
    }
  }
  return NextResponse.json({
    status: "granted",
    clientName: grant.clientName,
    email,
  });
}

// Liga/desliga o portal do cliente explicitamente (kill-switch por cliente).
export async function PATCH(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;
  const enabled = body.enabled;
  if (!clientId || typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "clientId e enabled (boolean) obrigatórios." },
      { status: 400 },
    );
  }
  const convex = getConvexClient();
  const res = await convex.mutation(api.portal.setPortalEnabledForBackend, {
    serviceKey,
    clientId: clientId as Id<"clients">,
    enabled,
  });
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: enabled ? "portal.enabled" : "portal.disabled",
      actorUserId: admin.id,
      actorEmail: admin.email ?? undefined,
      actorKind: "internal",
      clientId: clientId as Id<"clients">,
      targetType: "client",
      targetId: clientId,
      outcome: "success",
      detail: enabled
        ? "portal habilitado"
        : "portal desabilitado (kill-switch)",
    });
  } catch (e) {
    console.error("portal-access: falha ao auditar toggle do portal", e);
  }
  return NextResponse.json({
    status: enabled ? "enabled" : "disabled",
    clientName: res.clientName,
  });
}

export async function DELETE(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const clientId = body.clientId as string | undefined;
  const userId = body.userId as string | undefined;
  if (!clientId || !userId) {
    return NextResponse.json(
      { error: "clientId e userId obrigatórios." },
      { status: 400 },
    );
  }
  const convex = getConvexClient();
  await convex.mutation(api.portal.revokePortalAccessForBackend, {
    serviceKey,
    userId,
    clientId: clientId as Id<"clients">,
  });
  try {
    await convex.mutation(api.securityAudit.recordSecurityEventForBackend, {
      serviceKey,
      eventType: "membership.revoked",
      actorUserId: admin.id,
      actorEmail: admin.email ?? undefined,
      actorKind: "internal",
      clientId: clientId as Id<"clients">,
      targetType: "user",
      targetId: userId,
      outcome: "success",
      detail: "portal revoke",
    });
  } catch (e) {
    console.error("portal-access: falha ao auditar revoke", e);
  }
  return NextResponse.json({ status: "revoked" });
}
