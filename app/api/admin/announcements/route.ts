import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const runtime = "nodejs";

function getServiceKey(): string | null {
  return process.env.CONVEX_SERVICE_ROLE_KEY ?? null;
}

type Level = "info" | "warning" | "success";
function normLevel(v: unknown): Level {
  return v === "warning" || v === "success" ? v : "info";
}
function optNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function optStr(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s || undefined;
}

export async function GET() {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }
  const items = await getConvexClient().query(api.announcements.list, {
    serviceKey,
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (CONVEX_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  let body: {
    action?: string;
    id?: string;
    active?: boolean;
    announcement?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const convex = getConvexClient();

  if (body.action === "delete") {
    if (!body.id)
      return NextResponse.json({ error: "id required" }, { status: 400 });
    await convex.mutation(api.announcements.remove, {
      serviceKey,
      id: body.id as Id<"announcements">,
    });
    return NextResponse.json({ success: true });
  }

  if (body.action === "toggle") {
    if (!body.id)
      return NextResponse.json({ error: "id required" }, { status: 400 });
    await convex.mutation(api.announcements.setActive, {
      serviceKey,
      id: body.id as Id<"announcements">,
      active: Boolean(body.active),
    });
    return NextResponse.json({ success: true });
  }

  // create / update
  const a = body.announcement ?? {};
  const title = optStr(a.title);
  const text = optStr(a.body);
  if (!title || !text) {
    return NextResponse.json(
      { error: "Título e mensagem são obrigatórios." },
      { status: 400 },
    );
  }
  const starts = optNum(a.starts_at);
  const ends = optNum(a.ends_at);
  if (starts !== undefined && ends !== undefined && ends < starts) {
    return NextResponse.json(
      { error: "Data de fim não pode ser antes do início." },
      { status: 400 },
    );
  }
  const cta_label = optStr(a.cta_label);
  const cta_url = optStr(a.cta_url);
  if (cta_url && !/^https?:\/\/.+/i.test(cta_url)) {
    return NextResponse.json(
      { error: "URL do botão deve começar com http(s)://" },
      { status: 400 },
    );
  }

  const common = {
    serviceKey,
    title,
    body: text,
    level: normLevel(a.level),
    active: Boolean(a.active),
    dismissible: a.dismissible === undefined ? true : Boolean(a.dismissible),
    starts_at: starts,
    ends_at: ends,
    cta_label,
    cta_url: cta_label ? cta_url : undefined,
  };

  if (body.action === "update") {
    if (!body.id)
      return NextResponse.json({ error: "id required" }, { status: 400 });
    await convex.mutation(api.announcements.update, {
      ...common,
      id: body.id as Id<"announcements">,
    });
    return NextResponse.json({ success: true });
  }

  if (body.action === "create") {
    const id = await convex.mutation(api.announcements.create, {
      ...common,
      createdBy: admin.email ?? admin.id,
    });
    return NextResponse.json({ success: true, id });
  }

  return NextResponse.json(
    { error: "Unknown action (create|update|delete|toggle)" },
    { status: 400 },
  );
}
