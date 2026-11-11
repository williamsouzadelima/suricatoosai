import { NextRequest, NextResponse } from "next/server";
import { getSuperadminUser } from "@/lib/auth/require-superadmin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { recordAudit } from "@/lib/admin/audit";
import { decryptSecret, encryptSecret, last4 } from "@/lib/llm-keys/crypto";
import { invalidatePoolKeyCache } from "@/lib/llm-keys/pool-runtime";

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

type KeyInspection = {
  kind: "ok" | "provisioning" | "invalid" | "limited" | "unknown";
  detail: string;
};

/**
 * Inspeciona uma chave no OpenRouter via GET /api/v1/key (os metadados da própria
 * chave). Decisivo para pegar o erro mais comum: uma chave de PROVISIONAMENTO/
 * Management lê o saldo (/credits responde 200) mas NÃO executa inferência — o
 * /chat/completions responde o enganoso "User not found." (401). Fail-open: se o
 * OpenRouter não responde, retorna "unknown" (nunca bloqueia por hiccup).
 */
async function inspectOpenRouterKey(plaintext: string): Promise<KeyInspection> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${plaintext}` },
    });
    if (r.status === 401 || r.status === 403) {
      return {
        kind: "invalid",
        detail: `Chave inválida ou sem permissão (HTTP ${r.status}).`,
      };
    }
    if (!r.ok) {
      return { kind: "unknown", detail: `OpenRouter respondeu HTTP ${r.status} em /key.` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      data?: {
        is_provisioning_key?: boolean;
        is_management_key?: boolean;
        limit_remaining?: number | null;
      };
    };
    const d = j?.data ?? {};
    if (d.is_provisioning_key || d.is_management_key) {
      return {
        kind: "provisioning",
        detail:
          'Esta é uma chave de PROVISIONAMENTO/Management do OpenRouter — ela NÃO executa inferência (o chat responde "User not found"). No painel do OpenRouter, gere uma chave de API normal (Keys → Create Key) e use essa aqui.',
      };
    }
    if (typeof d.limit_remaining === "number" && d.limit_remaining <= 0) {
      return {
        kind: "limited",
        detail: "O limite de gasto desta chave foi atingido (limit_remaining ≤ 0).",
      };
    }
    return { kind: "ok", detail: "Chave de inferência válida." };
  } catch {
    return {
      kind: "unknown",
      detail: "Não foi possível contatar o OpenRouter para inspecionar a chave.",
    };
  }
}

/** Valida o provedor contra o conjunto fechado (H3). Vazio → openrouter. */
function validProvider(v: unknown): "openrouter" | "unorouter" {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "unorouter") return "unorouter";
  if (s === "" || s === "openrouter") return "openrouter";
  throw new Error(`Provedor inválido: "${s}". Use "openrouter" ou "unorouter".`);
}

/**
 * Inspeciona uma chave do UNOROUTER via PROBE DE INFERÊNCIA (H4): `/v1/key` e
 * `/v1/credits` só provam autenticação/saldo — NÃO provam que a chave RODA modelo
 * (a mesma armadilha da chave de provisionamento do OpenRouter). Um POST
 * /chat/completions com max_tokens:1 contra um modelo free é o teste autoritativo
 * de "válida". Fail-open: hiccup → "unknown" (nunca bloqueia por instabilidade).
 */
async function inspectUnoRouterKey(plaintext: string): Promise<KeyInspection> {
  try {
    const r = await fetch("https://api.unorouter.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${plaintext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gemma-4-31b-it:free",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    if (r.status === 401 || r.status === 403) {
      return {
        kind: "invalid",
        detail: `Chave UnoRouter inválida ou sem permissão (HTTP ${r.status}).`,
      };
    }
    if (r.status === 402) {
      return {
        kind: "limited",
        detail:
          "Conta UnoRouter sem crédito (HTTP 402) — mesmo os modelos free exigem saldo ≥ 0.",
      };
    }
    if (r.ok) {
      return {
        kind: "ok",
        detail: "Chave UnoRouter válida — faz inferência (probe de 1 token OK).",
      };
    }
    const t = await r.text().catch(() => "");
    return {
      kind: "unknown",
      detail: `UnoRouter respondeu HTTP ${r.status} no probe${t ? ": " + t.slice(0, 120) : ""}.`,
    };
  } catch {
    return {
      kind: "unknown",
      detail: "Não foi possível contatar o UnoRouter para testar a chave.",
    };
  }
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
      const provider = validProvider(body.provider);
      if (!key || key.length < 20) {
        throw new Error("Chave inválida (vazia ou curta demais).");
      }
      if (!label) throw new Error("Rótulo obrigatório.");
      // Rejeita na hora a chave do tipo errado — OpenRouter: provisionamento não
      // faz inferência; UnoRouter: probe de inferência prova que roda modelo.
      // Fail-open em hiccup (kind "unknown" não bloqueia).
      const addCheck =
        provider === "unorouter"
          ? await inspectUnoRouterKey(key)
          : await inspectOpenRouterKey(key);
      if (addCheck.kind === "provisioning" || addCheck.kind === "invalid") {
        throw new Error(addCheck.detail);
      }
      const enc = encryptSecret(key);
      const res = await convex.mutation(api.llmKeys.createKeyForBackend, {
        serviceKey,
        label,
        provider,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        last4: last4(key),
        priority: toNum(body.priority),
        createdBy: actor,
      });
      invalidatePoolKeyCache(provider); // M2: a chave nova vale já (não espera o TTL de 20s)
      await recordAudit(
        actor,
        "llm-chave.adicionar",
        label,
        `last4=${last4(key)} provider=${provider}`,
      );
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
      invalidatePoolKeyCache(); // M2: mudança no pool vale já (todos os providers)
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
      invalidatePoolKeyCache(); // M2
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
      invalidatePoolKeyCache(); // M2
      await recordAudit(actor, "llm-chave.remover", id, undefined);
      return NextResponse.json({ success: true });
    }

    if (body.action === "import-env") {
      if (!encConfigured()) {
        throw new Error("LLM_KEY_ENC_SECRET não configurado no servidor.");
      }
      const envKey = process.env.OPENROUTER_API_KEY;
      if (!envKey || envKey.length < 20) {
        return NextResponse.json(
          { error: "OPENROUTER_API_KEY não está configurada no servidor." },
          { status: 400 },
        );
      }
      const l4 = last4(envKey);
      const existing = await convex.query(api.llmKeys.listKeysForBackend, {
        serviceKey,
      });
      if (existing.some((k: { last4: string }) => k.last4 === l4)) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          detail: `Já existe uma chave terminando em ${l4} no pool.`,
        });
      }
      const enc = encryptSecret(envKey);
      const res = await convex.mutation(api.llmKeys.createKeyForBackend, {
        serviceKey,
        label: str(body.label) ?? "Ambiente (OPENROUTER_API_KEY)",
        provider: "openrouter",
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        last4: l4,
        priority: toNum(body.priority) ?? 50,
        createdBy: actor,
      });
      invalidatePoolKeyCache("openrouter"); // M2
      await recordAudit(actor, "llm-chave.importar-env", undefined, `last4=${l4}`);
      return NextResponse.json({ ok: true, id: res.id, last4: l4 });
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
      if (cipher.provider === "unorouter") {
        // UnoRouter: o teste autoritativo é um PROBE DE INFERÊNCIA (H4) — /key e
        // /credits não provam que a chave RODA modelo.
        const info = await inspectUnoRouterKey(plaintext);
        if (info.kind === "invalid") {
          status = "error";
          detail = info.detail;
        } else if (info.kind === "limited") {
          status = "exhausted";
          detail = info.detail;
        } else if (info.kind === "ok") {
          status = "active";
          detail = info.detail;
        } else {
          detail = info.detail; // unknown → status mantido
        }
      } else {
        // OpenRouter: 1) TIPO (provisionamento/management lê o saldo mas NÃO faz
        //    inferência — "User not found"); 2) saldo da conta via /credits.
        const info = await inspectOpenRouterKey(plaintext);
        if (info.kind === "provisioning" || info.kind === "invalid") {
          status = "error";
          detail = info.detail;
        } else if (info.kind === "limited") {
          status = "exhausted";
          detail = info.detail;
        } else {
          try {
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
                  detail = `Chave de inferência OK — conta com US$ ${rem.toFixed(2)} de saldo (US$ ${tu.toFixed(2)} de US$ ${tc.toFixed(2)}).`;
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
        }
      }
      if (status) {
        await convex.mutation(api.llmKeys.setKeyStatusForBackend, {
          serviceKey,
          id: id as Id<"llm_api_keys">,
          status,
          error: status === "active" ? undefined : detail,
        });
        invalidatePoolKeyCache(cipher.provider); // M2: status novo vale já
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
