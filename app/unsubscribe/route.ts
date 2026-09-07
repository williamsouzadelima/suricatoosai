import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { verifyUnsubToken } from "@/lib/marketing/send";

export const runtime = "nodejs";

function page(title: string, message: string, ok: boolean): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title></head>
  <body style="margin:0;background:#0a0a0a;color:#fafafa;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
    <div style="max-width:420px;text-align:center;padding:24px">
      <div style="font-weight:700;font-size:20px;margin-bottom:12px">Suricatoos</div>
      <div style="font-size:40px;margin-bottom:12px">${ok ? "✅" : "⚠️"}</div>
      <h1 style="font-size:18px;margin:0 0 8px">${title}</h1>
      <p style="color:#9ca3af;font-size:14px;margin:0">${message}</p>
    </div>
  </body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handle(req: NextRequest): Promise<{ ok: boolean; email?: string }> {
  const email = (req.nextUrl.searchParams.get("e") ?? "").trim().toLowerCase();
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const secret = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!email || !token || !secret) return { ok: false };
  if (!verifyUnsubToken(email, token, secret)) return { ok: false };
  try {
    await getConvexClient().mutation(api.emailMarketing.optOut, {
      serviceKey: secret,
      email,
      source: "unsubscribe-link",
    });
  } catch {
    // opt-out é best-effort; não expõe erro interno ao usuário
  }
  return { ok: true, email };
}

export async function GET(req: NextRequest) {
  const { ok, email } = await handle(req);
  return ok
    ? page(
        "Descadastro concluído",
        `${email} não receberá mais e-mails de marketing do Suricatoos.`,
        true,
      )
    : page(
        "Link inválido",
        "Este link de descadastro é inválido ou expirou.",
        false,
      );
}

// List-Unsubscribe-Post (one-click) — clientes de e-mail fazem POST.
export async function POST(req: NextRequest) {
  const { ok } = await handle(req);
  return new NextResponse(null, { status: ok ? 200 : 400 });
}
