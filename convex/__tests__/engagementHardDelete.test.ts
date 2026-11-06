import { describe, it, expect } from "@jest/globals";
// planEvidenceDeletion importa SÓ tipos (erasados) → nada de fileAggregate nem
// @convex-dev/aggregate carrega → sem o erro de ESM que derrubou a 1ª tentativa.
import { planEvidenceDeletion } from "../lib/evidenceDeletePlan";

type Row = { _id: string; [k: string]: unknown };
type Tables = Record<string, Row[]>;

// ctx-stub mínimo: query(table).withIndex(name, build).take()/first() filtrando
// pelos eq() do builder, e get(id) varrendo as tabelas.
function ctxOf(tables: Tables) {
  const result = (rows: Row[]) => ({
    take: async (n: number) => rows.slice(0, n),
    first: async () => rows[0] ?? null,
    collect: async () => rows,
  });
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_name: string, build: (q: unknown) => unknown) => {
          const filters: Array<{ field: string; value: unknown }> = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {
            eq: (field: string, value: unknown) => {
              filters.push({ field, value });
              return q;
            },
            gte: () => q,
            lte: () => q,
          };
          build(q);
          return result(
            (tables[table] ?? []).filter((r) =>
              filters.every((f) => r[f.field] === f.value),
            ),
          );
        },
      }),
      get: async (id: string) => {
        for (const rows of Object.values(tables)) {
          const row = rows.find((r) => r._id === id);
          if (row) return row;
        }
        return null;
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ctx as any;
}

describe("planEvidenceDeletion — margem de segurança do S3", () => {
  it("PRESERVA arquivo compartilhado com OUTRO engajamento; enfileira órfão + s3_key puro", async () => {
    const tables: Tables = {
      evidence: [
        { _id: "ev1", engagement_id: "E", s3_key: "s1", file_id: "f1" },
        { _id: "ev2", engagement_id: "E", s3_key: "s2" }, // s3_key puro, sem file
        { _id: "ev3", engagement_id: "E", s3_key: "s3", file_id: "f3" },
        { _id: "ev3b", engagement_id: "OTHER", file_id: "f3" }, // outro eng usa f3
      ],
      files: [
        { _id: "f1", s3_key: "s1" },
        { _id: "f3", s3_key: "s3" },
      ],
    };
    const batch = tables.evidence.filter((e) => e.engagement_id === "E");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = await planEvidenceDeletion(ctxOf(tables), batch as any, 25);
    expect(plan.filesToDelete.map((f) => f._id)).toEqual(["f1"]); // f3 preservado
    expect([...plan.s3KeysToEnqueue].sort()).toEqual(["s1", "s2"]); // s3 NUNCA
  });

  it("todas as evidências órfãs → apaga os files e enfileira suas chaves", async () => {
    const tables: Tables = {
      evidence: [{ _id: "e1", engagement_id: "E", s3_key: "k1", file_id: "fa" }],
      files: [{ _id: "fa", s3_key: "k1" }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = await planEvidenceDeletion(ctxOf(tables), tables.evidence as any, 25);
    expect(plan.filesToDelete.map((f) => f._id)).toEqual(["fa"]);
    expect(plan.s3KeysToEnqueue).toEqual(["k1"]);
  });

  it("evidência só com s3_key (sem file) e sem dono em files → enfileira direto", async () => {
    const tables: Tables = {
      evidence: [{ _id: "e1", engagement_id: "E", s3_key: "only" }],
      files: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = await planEvidenceDeletion(ctxOf(tables), tables.evidence as any, 25);
    expect(plan.filesToDelete).toHaveLength(0);
    expect(plan.s3KeysToEnqueue).toEqual(["only"]);
  });

  it("s3_key diverge da chave do file: enfileira a do FILE, não a direta (dono existe)", async () => {
    const tables: Tables = {
      evidence: [{ _id: "e1", engagement_id: "E", s3_key: "dir", file_id: "fb" }],
      files: [{ _id: "fb", s3_key: "filekey" }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plan = await planEvidenceDeletion(ctxOf(tables), tables.evidence as any, 25);
    expect(plan.filesToDelete.map((f) => f._id)).toEqual(["fb"]);
    // "dir" não tem dono em files → seria direto; "filekey" vem do file apagado.
    expect([...plan.s3KeysToEnqueue].sort()).toEqual(["dir", "filekey"]);
  });
});
