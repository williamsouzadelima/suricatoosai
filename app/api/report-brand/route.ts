import { NextRequest, NextResponse } from "next/server";
import { getInternalUser } from "@/lib/auth/require-internal";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

/**
 * Marca dos relatórios do analista (logo/cores/contato/prefixo do código).
 * GET carrega os valores atuais; PUT faz upsert. Gateado por getInternalUser;
 * a chave de serviço nunca vai ao browser. Campos vazios caem para o padrão
 * (DEFAULT_BRAND = Suricatoos) na geração.
 */

export async function GET() {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  const brand = await getConvexClient().query(
    api.reports.getReportBrandForBackend,
    { serviceKey, userId: staff.user.id },
  );
  return NextResponse.json({ brand });
}

export async function PUT(req: NextRequest) {
  const staff = await getInternalUser();
  if (!staff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const str = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string) : undefined;

  try {
    await getConvexClient().mutation(api.reports.upsertReportBrandForBackend, {
      serviceKey,
      userId: staff.user.id,
      name: str("name"),
      wordmark: str("wordmark"),
      tagline: str("tagline"),
      contact: str("contact"),
      docCodePrefix: str("docCodePrefix"),
      primary: str("primary"),
      accent: str("accent"),
      classification: str("classification"),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("report-brand upsert:", error);
    return NextResponse.json({ error: "Falha ao salvar" }, { status: 500 });
  }
}
