import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { recordAudit } from "@/lib/admin/audit";
import { decryptSecret, encryptSecret, last4 } from "@/lib/llm-keys/crypto";

/**
 * Admin do pool de chaves de LLM. Superadmin-only. A chave em texto puro é
 * CIFRADA aqui (Node, node:crypto) antes de ir ao Convex; nunca é logada nem
 * devolvida ao cliente (só o rótulo e os últimos-4).
 */

export const runtime = "nodejs";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function encConfigured(): boolean {
  const s = process.env.LLM_KEY_ENC_SECRET;
  return !!s && s.length >= 16;
}

export async function GET() {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  const convex = getConvexClient();
  const keys = await convex.query(api.llmKeys.listKeysForBackend, { serviceKey });
  return NextResponse.json({
    keys,
    encConfigured: encConfigured(),
    envKeyPresent: !!process.env.OPENROUTER_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  const admin = await getSuperadminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  const convex = getConvexClient();
  const actor = admin.email ?? admin.id;

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    key?: string;
    label?: string;
    provider?: string;
    priority?: unknown;
    id?: string;
    enabled?: boolean;
    status?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  try {
    if (body.action === "add") {
      if (!encConfigured()) {
        throw new Error(
          "LLM_KEY_ENC_SECRET não configurado no servidor — defina o segredo-mestre de criptografia antes de adicionar chaves.",
        );
      }
      const key = str(body.key);
      const label = str(body.label);
      if (!key || key.length < 20) {
        throw new Error("Chave inválida (vazia ou curta demais).");
      }
      if (!label) throw new Error("Rótulo obrigatório.");
      const enc = encryptSecret(key);
      const res = await convex.mutation(api.llmKeys.createKeyForBackend, {
        serviceKey,
        label,
        provider: str(body.provider) ?? "openrouter",
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        last4: last4(key),
        priority: toNum(body.priority),
        createdBy: actor,
      });
      await recordAudit(actor, "llm-chave.adicionar", label, `last4=${last4(key)}`);
      return NextResponse.json({ success: true, id: res.id, last4: last4(key) });
    }

    if (body.action === "update") {
      const id = str(body.id);
      if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
      await convex.mutation(api.llmKeys.updateKeyForBackend, {
        serviceKey,
        id: id as Id<"llm_api_keys">,
        label: str(body.label),
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        priority: toNum(body.priority),
      });
      await recordAudit(
        actor,
        "llm-chave.editar",
        id,
        body.enabled === false
          ? "desligada"
          : body.enabled === true
            ? "ligada"
            : "editada",
      );
      return NextResponse.json({ success: true });
    }

    if (body.action === "set-status") {
      const id = str(body.id);
      const status = str(body.status);
      if (!id || !status) {
        return NextResponse.json({ error: "id/status obrigatório" }, { status: 400 });
      }
      if (!["untested", "active", "exhausted", "error"].includes(status)) {
        return NextResponse.json({ error: "status inválido" }, { status: 400 });
      }
      await convex.mutation(api.llmKeys.setKeyStatusForBackend, {
        serviceKey,
        id: id as Id<"llm_api_keys">,
        status: status as "untested" | "active" | "exhausted" | "error",
      });
      await recordAudit(actor, "llm-chave.status", id, status);
      return NextResponse.json({ success: true });
    }

    if (body.action === "delete") {
      const id = str(body.id);
      if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
      await convex.mutation(api.llmKeys.deleteKeyForBackend, {
        serviceKey,
        id: id as Id<"llm_api_keys">,
      });
      await recordAudit(actor, "llm-chave.remover", id, undefined);
      return NextResponse.json({ success: true });
    }

    if (body.action === "test") {
      const id = str(body.id);
      if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
      if (!encConfigured()) {
        throw new Error("LLM_KEY_ENC_SECRET não configurado no servidor.");
      }
      const cipher = await convex.query(api.llmKeys.getKeyCipherForBackend, {
        serviceKey,
        id: id as Id<"llm_api_keys">,
      });
      if (!cipher) {
        return NextResponse.json({ error: "chave não encontrada" }, { status: 404 });
      }
      let plaintext: string;
      try {
        plaintext = decryptSecret({
          ciphertext: cipher.ciphertext,
          iv: cipher.iv,
          authTag: cipher.authTag,
        });
      } catch {
        await convex.mutation(api.llmKeys.setKeyStatusForBackend, {
          serviceKey,
          id: id as Id<"llm_api_keys">,
          status: "error",
          error: "falha ao decifrar (segredo-mestre mudou?)",
        });
        return NextResponse.json({
          ok: true,
          status: "error",
          detail: "Falha ao decifrar a chave — o segredo-mestre pode ter mudado.",
        });
      }
      // null = não altera o status (erro transitório não exclui chave boa).
      let status: "active" | "exhausted" | "error" | null = null;
      let detail = "";
      try {
        // Saldo da CONTA (definitivo): /api/v1/credits não depende de modelo e
        // reflete exatamente o que causa o 402 "Insufficient credits".
        const r = await fetch("https://openrouter.ai/api/v1/credits", {
          headers: { Authorization: `Bearer ${plaintext}` },
        });
        if (r.status === 401 || r.status === 403) {
          status = "error";
          detail = `Chave inválida ou sem permissão (HTTP ${r.status}).`;
        } else if (r.ok) {
          const j = (await r.json().catch(() => ({}))) as {
            data?: { total_credits?: number; total_usage?: number };
          };
          const tc = j?.data?.total_credits;
          const tu = j?.data?.total_usage;
          if (typeof tc === "number" && typeof tu === "number") {
            const rem = tc - tu;
            if (rem <= 0) {
              status = "exhausted";
              detail = `Sem crédito na conta (usado US$ ${tu.toFixed(2)} de US$ ${tc.toFixed(2)}).`;
            } else {
              status = "active";
              detail = `Conta com crédito: resta US$ ${rem.toFixed(2)} (US$ ${tu.toFixed(2)} de US$ ${tc.toFixed(2)}).`;
            }
          } else {
            status = "active";
            detail = "Chave válida (OpenRouter não retornou o saldo).";
          }
        } else {
          const t = await r.text().catch(() => "");
          detail = `Erro transitório ao testar (HTTP ${r.status})${t ? ": " + t.slice(0, 120) : ""} — status mantido.`;
        }
      } catch {
        detail = "Falha ao contatar o OpenRouter — status mantido.";
      }
      if (status) {
        await convex.mutation(api.llmKeys.setKeyStatusForBackend, {
          serviceKey,
          id: id as Id<"llm_api_keys">,
          status,
          error: status === "active" ? undefined : detail,
        });
      }
      await recordAudit(actor, "llm-chave.testar", id, status ?? "unchanged");
      return NextResponse.json({ ok: true, status: status ?? "unchanged", detail });
    }

    return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "erro ao processar" },
      { status: 400 },
    );
  }
}
