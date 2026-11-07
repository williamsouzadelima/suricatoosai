/**
 * Seleção PURA da próxima chave do pool a usar. Testável sem o runtime Convex.
 * Usável = habilitada E status active|untested (exhausted/error ficam de fora).
 * Ordem: menor prioridade primeiro; empate pela mais antiga (created_at).
 */

export type PoolKeyLite = {
  _id: string;
  enabled: boolean;
  priority: number;
  status: "untested" | "active" | "exhausted" | "error";
  created_at: number;
};

export function pickActiveKey<T extends PoolKeyLite>(
  keys: T[],
  opts?: { excludeIds?: string[] },
): T | null {
  const exclude = new Set(opts?.excludeIds ?? []);
  const candidates = keys
    .filter(
      (k) =>
        k.enabled &&
        (k.status === "active" || k.status === "untested") &&
        !exclude.has(k._id),
    )
    .sort((a, b) => a.priority - b.priority || a.created_at - b.created_at);
  return candidates[0] ?? null;
}
