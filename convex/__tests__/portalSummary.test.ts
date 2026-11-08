import { describe, it, expect } from "@jest/globals";
// buildPortalSummary importa SÓ tipos (erasados) → NÃO carrega fileAggregate nem
// @convex-dev/aggregate (o ESM que derruba o jest). ctx-stub mínimo, mesmo
// padrão de evidenceDeletePlan.test / engagementHardDelete.test.
import {
  buildPortalSummary,
  buildPortalSummaryAuditRow,
} from "../lib/portalSummary";

type Row = { _id: string; [k: string]: unknown };
type Tables = Record<string, Row[]>;

// ctx-stub: query(table).withIndex(name, build).order()?.take(n)/collect(),
// filtrando pelos eq() do builder. order() é no-op (agregação não depende de ordem).
function ctxOf(tables: Tables) {
  const chain = (rows: Row[]) => {
    const c = {
      order: (_dir?: string) => c,
      take: async (n: number) => rows.slice(0, n),
      collect: async () => rows,
      first: async () => rows[0] ?? null,
    };
    return c;
  };
  const db = {
    query: (table: string) => ({
      withIndex: (_name: string, build: (q: unknown) => unknown) => {
        const filters: Array<{ field: string; value: unknown }> = [];
        const q: any = {
          eq: (field: string, value: unknown) => {
            filters.push({ field, value });
            return q;
          },
          gte: () => q,
          lte: () => q,
          gt: () => q,
          lt: () => q,
        };
        build(q);
        const rows = (tables[table] ?? []).filter((r) =>
          filters.every((f) => r[f.field] === f.value),
        );
        return chain(rows);
      },
    }),
    get: async (id: string) => {
      for (const rows of Object.values(tables)) {
        const r = rows.find((x) => x._id === id);
        if (r) return r;
      }
      return null;
    },
  };
  return { db } as any;
}

const granted = async () => ({ client: { _id: "C1", name: "Cli" } as any });
const denied = async () => null;

function fixtures(): Tables {
  return {
    engagements: [
      {
        _id: "E1",
        client_id: "C1",
        name: "Eng Um",
        status: "active",
        starts_at: 1000,
        scope: [{ kind: "domain", value: "a.com", in_scope: true }],
      },
      { _id: "E2", client_id: "C1", name: "Eng Dois", status: "closed" },
      {
        _id: "E3",
        client_id: "C1",
        name: "Eng Tres",
        status: "planned",
        ends_at: 2000,
        scope: [],
      },
      {
        _id: "E4",
        client_id: "C1",
        name: "Arquivado",
        status: "active",
        archived_at: 5,
        scope: [{ kind: "ip", value: "1.1.1.1", in_scope: true }],
      },
      {
        _id: "E5",
        client_id: "C1",
        name: "Apagado",
        status: "active",
        hard_deleted_at: 6,
      },
      { _id: "EX", client_id: "OUTRO", name: "Outro", status: "active" },
    ],
    findings: [
      {
        _id: "F1",
        engagement_id: "E1",
        status: "published",
        severity: "critical",
        published_at: 100,
        cvss_score: 9.1,
        cvss_version: "4.0",
        cvss_vector: "CVSS:4.0/AV:N",
        finding_id: "F-001",
        title: "SQLi",
        affected_asset: "a.com",
        weakness_class: "sqli",
        cwe: "CWE-89",
      },
      {
        _id: "F2",
        engagement_id: "E1",
        status: "published",
        severity: "high",
        retest_status: "fixed",
        retested_at: 95,
        published_at: 90,
        title: "XSS",
        affected_asset: "a.com",
        weakness_class: "xss",
      },
      {
        _id: "F3",
        engagement_id: "E1",
        status: "published",
        severity: "medium",
        retest_status: "pending",
        published_at: 80,
        title: "CSRF",
        affected_asset: "a.com",
        weakness_class: "csrf",
      },
      {
        _id: "Fdraft",
        engagement_id: "E1",
        status: "draft",
        severity: "critical",
        title: "rascunho",
        affected_asset: "x",
        weakness_class: "x",
      },
      {
        _id: "F4",
        engagement_id: "E2",
        status: "published",
        severity: "critical",
        retest_status: "still_vulnerable",
        retested_at: 210,
        published_at: 200,
        cvss_score: 9.8,
        title: "RCE",
        affected_asset: "b.com",
        weakness_class: "rce",
      },
      {
        _id: "F5",
        engagement_id: "E2",
        status: "published",
        severity: "low",
        title: "Info",
        affected_asset: "b.com",
        weakness_class: "info",
      },
      {
        _id: "F6",
        engagement_id: "E4",
        status: "published",
        severity: "critical",
        published_at: 300,
        title: "oculto-arquivado",
        affected_asset: "c",
        weakness_class: "c",
      },
      {
        _id: "F7",
        engagement_id: "E5",
        status: "published",
        severity: "critical",
        published_at: 400,
        title: "oculto-apagado",
        affected_asset: "d",
        weakness_class: "d",
      },
    ],
    reports: [
      {
        _id: "R1",
        engagement_id: "E1",
        status: "ready",
        client_visible: true,
        audience: "executive",
        format: "docx",
        version: 2,
        report_group_id: "G1",
        created_at: 500,
      },
      {
        _id: "R2",
        engagement_id: "E1",
        status: "ready",
        audience: "executive",
        format: "pdf",
        version: 2,
        report_group_id: "G1",
        created_at: 500,
      },
      {
        _id: "R3",
        engagement_id: "E1",
        status: "ready",
        client_visible: true,
        audience: "technical",
        format: "docx",
        version: 1,
        report_group_id: "G3",
        created_at: 400,
      },
      {
        _id: "R5",
        engagement_id: "E1",
        status: "ready",
        client_visible: true,
        audience: "executive",
        format: "docx",
        version: 3,
        report_group_id: "G5",
        created_at: 700,
        deleted_at: 701,
      },
      {
        _id: "R6",
        engagement_id: "E1",
        status: "ready",
        client_visible: false,
        audience: "executive",
        format: "docx",
        version: 4,
        report_group_id: "G6",
        created_at: 800,
      },
      {
        _id: "R4",
        engagement_id: "E2",
        status: "ready",
        client_visible: true,
        audience: "executive",
        format: "docx",
        version: 1,
        report_group_id: "G2",
        created_at: 600,
      },
      {
        _id: "Rq",
        engagement_id: "E2",
        status: "queued",
        client_visible: true,
        audience: "executive",
        format: "docx",
        version: 5,
        report_group_id: "G9",
        created_at: 900,
      },
    ],
    evidence: [
      { _id: "ev1", finding_id: "F4" },
      { _id: "ev2", finding_id: "F4" },
      { _id: "ev3", finding_id: "F4" },
      { _id: "ev4", finding_id: "F1" },
      { _id: "ev5", finding_id: "F1" },
    ],
  };
}

describe("buildPortalSummary", () => {
  it("nega por padrão → null (nunca objeto zerado)", async () => {
    const s = await buildPortalSummary(
      ctxOf(fixtures()),
      { userId: "u", clientId: "C1" as never, nowMs: 999 },
      denied as never,
    );
    expect(s).toBeNull();
  });

  it("agrega só engajamentos VISÍVEIS; reconcilia header == soma das linhas", async () => {
    const s = await buildPortalSummary(
      ctxOf(fixtures()),
      { userId: "u", clientId: "C1" as never, nowMs: 999 },
      granted as never,
    );
    if (!s) throw new Error("esperava resumo");

    expect(s.generatedAt).toBe(999);
    expect(s.truncated).toBe(false);

    // Visibilidade: E4 (arquivado) e E5 (hard-deletado) e EX (outro cliente) fora.
    expect(s.engagements.total).toBe(3);
    expect(s.perEngagement.map((r) => r.engagementId).sort()).toEqual([
      "E1",
      "E2",
      "E3",
    ]);
    expect(s.engagements.byStatus).toEqual({
      planned: 1,
      active: 1,
      review: 0,
      reporting: 0,
      closed: 1,
    });
    expect(s.engagements.withWindow).toBe(2); // E1 starts, E3 ends
    expect(s.engagements.withScope).toBe(1); // E1 (E3 scope vazio não conta)
    expect(s.engagements.withFindings).toBe(2); // E1, E2 publicam; E3 não
    // perEngagement expressa "não medido" (status + nome; sem 2ª busca de eng)
    const e3row = s.perEngagement.find((r) => r.engagementId === "E3");
    expect(e3row).toMatchObject({
      engagementName: "Eng Tres",
      status: "planned",
      published: 0,
      open: 0,
    });

    // Achados — F6/F7 (eng arquivado/apagado) NÃO contados; Fdraft (não publicado) fora.
    expect(s.findings.published).toBe(5);
    expect(s.findings.publishedWithoutDate).toBe(1); // F5
    expect(s.findings.open).toBe(4); // F1,F3,F4,F5 (F2 fixed fora)
    expect(s.findings.openBySeverity).toEqual({
      critical: 2,
      high: 0,
      medium: 1,
      low: 1,
      info: 0,
    });
    expect(s.findings.openCriticalHigh).toBe(2);
    expect(s.findings.worstOpenSeverity).toBe("critical");
    expect(s.findings.retest).toEqual({
      fixed: 1,
      stillVulnerable: 1,
      pending: 1,
      notRetested: 2,
    });
    // somas das 4 caixas de reteste == publicados
    const rt = s.findings.retest;
    expect(rt.fixed + rt.stillVulnerable + rt.pending + rt.notRetested).toBe(
      s.findings.published,
    );
    expect(s.findings.lastPublishedAt).toBe(200);
    expect(s.findings.lastRetestedAt).toBe(210);

    // Reconciliação: header == soma do perEngagement
    const sum = (f: (r: (typeof s.perEngagement)[number]) => number) =>
      s.perEngagement.reduce((a, r) => a + f(r), 0);
    expect(sum((r) => r.published)).toBe(s.findings.published);
    expect(sum((r) => r.open)).toBe(s.findings.open);
    expect(sum((r) => r.openCriticalHigh)).toBe(s.findings.openCriticalHigh);
  });

  it("prioridades: top-5 ordenadas (sev→cvss→publicado→id) + evidenceCount só delas", async () => {
    const s = await buildPortalSummary(
      ctxOf(fixtures()),
      { userId: "u", clientId: "C1" as never, nowMs: 999 },
      granted as never,
    );
    if (!s) throw new Error("esperava resumo");
    expect(s.priorities.map((p) => p.id)).toEqual(["F4", "F1", "F3", "F5"]);
    const byId = Object.fromEntries(
      s.priorities.map((p) => [p.id, p.evidenceCount]),
    );
    expect(byId).toEqual({ F4: 3, F1: 2, F3: 0, F5: 0 });
    // nunca expõe campos sensíveis
    const keys = Object.keys(s.priorities[0]);
    for (const banned of [
      "retestNote",
      "retest_note",
      "reproductionSteps",
      "reproduction_steps",
      "reviewedBy",
      "dedupFingerprint",
      "sourceType",
      "verdict",
      "confidence",
    ]) {
      expect(keys).not.toContain(banned);
    }
  });

  it("relatórios: available=grupos distintos; latestExecutive=mais recente por data", async () => {
    const s = await buildPortalSummary(
      ctxOf(fixtures()),
      { userId: "u", clientId: "C1" as never, nowMs: 999 },
      granted as never,
    );
    if (!s) throw new Error("esperava resumo");
    // 3 ENTREGÁVEIS distintos (R1+R2 compartilham G1), não 4 linhas-por-formato.
    expect(s.reports.available).toBe(3);
    expect(s.reports.lastCreatedAt).toBe(600);
    // G2 (data 600) é mais RECENTE que G1 (data 500) apesar da versão menor —
    // version NÃO compara entre engajamentos.
    expect(s.reports.latestExecutive).toEqual({
      engagementId: "E2",
      engagementName: "Eng Dois",
      version: 1,
      createdAt: 600,
      formats: ["docx"],
    });
  });
});

describe("buildPortalSummaryAuditRow", () => {
  it("concedido → portal.summary_viewed/success, portfolio_summary, SEM engagement_id", () => {
    const row = buildPortalSummaryAuditRow(
      { userId: "u", clientId: "C1" as never, actorEmail: "a@b.c" },
      true,
      5,
      3,
      999,
    );
    expect(row.event_type).toBe("portal.summary_viewed");
    expect(row.outcome).toBe("success");
    expect(row.actor_kind).toBe("client");
    expect(row.target_type).toBe("portfolio_summary");
    expect(row.target_id).toBe("C1");
    expect(Object.prototype.hasOwnProperty.call(row, "engagement_id")).toBe(
      false,
    );
    expect(row.detail).toContain("5 achado(s)");
    expect(row.detail).toContain("3 engajamento(s)");
    expect(row.created_at).toBe(999);
  });

  it("negado → access.denied/denied", () => {
    const row = buildPortalSummaryAuditRow(
      { userId: "u", clientId: "C1" as never },
      false,
      0,
      0,
      1,
    );
    expect(row.event_type).toBe("access.denied");
    expect(row.outcome).toBe("denied");
  });
});
