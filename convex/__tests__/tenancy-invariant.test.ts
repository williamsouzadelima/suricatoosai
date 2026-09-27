import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * INVARIANTE DE TENANCY — rede de segurança estrutural (a "blindagem" contra
 * IDOR futuro). Toda query/mutation nos arquivos de DOMÍNIO que toca `ctx.db`
 * precisa referenciar ao menos um SINAL de tenancy sancionado: um helper de
 * convex/lib/tenantGuards, uma checagem de posse inline (identity.subject /
 * .user_id), validateServiceKey/serviceKey (funções *ForBackend), ou
 * resolveMembership (portal). Se uma função NOVA tocar o banco sem nenhum sinal,
 * este teste QUEBRA o CI — pegando o "esqueci a checagem" antes de virar IDOR.
 *
 * NÃO prova a corretude do check (isso é dos testes por função + tenantGuards);
 * garante que NENHUMA função de domínio existe sem consideração de tenant, sem
 * precisar migrar as ~30 funções vivas para um builder (risco sobre authz
 * correta) nem adicionar dependência.
 */

const DOMAIN_FILES = [
  "convex/clients.ts",
  "convex/engagements.ts",
  "convex/findings.ts",
  "convex/reports.ts",
  "convex/portal.ts",
];

const TENANCY_SIGNALS = [
  "validateServiceKey",
  "requireIdentity",
  "requireOwnedDoc",
  "getOwnedDoc",
  "requireOwnedFinding",
  "assertOwnedEngagement",
  "ownedInvoice",
  "resolveMembership",
  "identity.subject",
  "args.userId",
  "args.serviceKey",
  ".user_id",
];

// Funções públicas-por-design que legitimamente NÃO checam tenant. Adicionar
// aqui só com justificativa explícita no PR.
const PUBLIC_BY_DESIGN = new Set<string>([]);

function extractBlocks(src: string): { name: string; body: string }[] {
  const re = /export const (\w+)\s*=\s*(query|mutation)\(/g;
  const starts: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    starts.push({ name: m[1], index: m.index });
  }
  return starts.map((s, i) => ({
    name: s.name,
    body: src.slice(
      s.index,
      i + 1 < starts.length ? starts[i + 1].index : src.length,
    ),
  }));
}

describe("invariante de tenancy nas funções de domínio", () => {
  for (const rel of DOMAIN_FILES) {
    it(`${rel}: toda função que toca ctx.db passa por um gate de tenant`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      const blocks = extractBlocks(src);
      // sanity: o scanner realmente encontrou funções (protege contra regex quebrada)
      expect(blocks.length).toBeGreaterThan(0);
      const offenders = blocks
        .filter(
          (b) =>
            b.body.includes("ctx.db") &&
            !PUBLIC_BY_DESIGN.has(b.name) &&
            !TENANCY_SIGNALS.some((sig) => b.body.includes(sig)),
        )
        .map((b) => b.name);
      expect(offenders).toEqual([]);
    });
  }
});
