import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  internalMutation: jest.fn((config: unknown) => config),
  mutation: jest.fn((config: unknown) => config),
  query: jest.fn((config: unknown) => config),
}));
jest.mock("convex/values", () => {
  const vfn = jest.fn(() => "validator");
  return {
    v: {
      number: vfn,
      optional: vfn,
      object: vfn,
      string: vfn,
      boolean: vfn,
      union: vfn,
      literal: vfn,
      null: vfn,
      array: vfn,
    },
    ConvexError: class ConvexError extends Error {
      data: unknown;
      constructor(data: { message: string }) {
        super(data.message);
        this.data = data;
      }
    },
  };
});
jest.mock("../lib/utils", () => ({ validateServiceKey: jest.fn() }));
// jose é ESM-only; estas funções não exercem JWT, então stub basta.
jest.mock("jose", () => ({ SignJWT: jest.fn() }));

const {
  revokeConnection,
  dismissRevokedConnector,
  unrevokeConnection,
  listRevokedConnectors,
  pollAgentUpdate,
} = require("../localSandbox") as typeof import("../localSandbox");

const authed = {
  getUserIdentity: jest.fn<any>().mockResolvedValue({ subject: "user-1" }),
};

// Mock de uma query de tabela única (dismiss, unrevoke, list):
// withIndex(apply).first()/.collect().
function queryReturning(terminal: Record<string, unknown>) {
  const eq = jest.fn<any>().mockReturnThis();
  const withIndex = jest.fn<any>((_name: string, apply: (q: any) => any) => {
    apply({ eq });
    return terminal;
  });
  const query = jest.fn<any>().mockReturnValue({ withIndex });
  return { query, withIndex, eq };
}

// revokeConnection faz duas queries por tabela: a conexão (by_connection_id) e
// a revogação existente (by_user_and_name). O mock ramifica por nome de tabela.
function revokeDb(opts: {
  connection: Record<string, unknown> | null;
  revoked: Record<string, unknown> | null;
}) {
  const patch = jest.fn<any>().mockResolvedValue(undefined);
  const insert = jest.fn<any>().mockResolvedValue(undefined);
  const del = jest.fn<any>().mockResolvedValue(undefined);
  const query = jest.fn<any>((table: string) => {
    const eq = jest.fn<any>().mockReturnThis();
    if (table === "local_sandbox_connections") {
      return {
        withIndex: (_name: string, apply: (q: any) => any) => {
          apply({ eq });
          return { first: jest.fn<any>().mockResolvedValue(opts.connection) };
        },
      };
    }
    if (table === "local_sandbox_revoked_connectors") {
      return {
        withIndex: (_name: string, apply: (q: any) => any) => {
          apply({ eq });
          return { first: jest.fn<any>().mockResolvedValue(opts.revoked) };
        },
      };
    }
    throw new Error(`unexpected table in query(): ${table}`);
  });
  return { query, patch, insert, delete: del };
}

// pollAgentUpdate toca três tabelas: tokens (validateToken), connections e
// revoked_connectors (isConnectorRevoked). O mock ramifica por nome de tabela
// e todas as leituras terminam em .first().
function pollDb(opts: {
  token: Record<string, unknown> | null;
  connection: Record<string, unknown> | null;
  revoked: Record<string, unknown> | null;
}) {
  const patch = jest.fn<any>().mockResolvedValue(undefined);
  const firstFor = (val: unknown) => {
    const eq = jest.fn<any>().mockReturnThis();
    return {
      withIndex: (_name: string, apply: (q: any) => any) => {
        apply({ eq });
        return { first: jest.fn<any>().mockResolvedValue(val) };
      },
    };
  };
  const query = jest.fn<any>((table: string) => {
    if (table === "local_sandbox_tokens") return firstFor(opts.token);
    if (table === "local_sandbox_connections") return firstFor(opts.connection);
    if (table === "local_sandbox_revoked_connectors")
      return firstFor(opts.revoked);
    throw new Error(`unexpected table in query(): ${table}`);
  });
  return { query, patch };
}

describe("pollAgentUpdate heartbeat + revoke signal", () => {
  beforeEach(() => jest.clearAllMocks());

  it("bumps last_heartbeat on a healthy connected poll (not revoked)", async () => {
    const db = pollDb({
      token: { user_id: "user-1" },
      connection: {
        _id: "conn1",
        user_id: "user-1",
        connection_name: "kali-x",
        status: "connected",
      },
      revoked: null,
    });
    const ctx = { db };

    await expect(
      pollAgentUpdate.handler(ctx as any, {
        token: "hsb_x",
        connectionId: "cid",
      }),
    ).resolves.toEqual({
      updateRequested: false,
      targetVersion: null,
      revoked: false,
    });
    expect(db.patch).toHaveBeenCalledWith("conn1", {
      last_heartbeat: expect.any(Number),
    });
  });

  it("reports revoked:true (and does not bump) when the name is revoked", async () => {
    const db = pollDb({
      token: { user_id: "user-1" },
      connection: {
        _id: "conn1",
        user_id: "user-1",
        connection_name: "kali-x",
        status: "connected",
      },
      revoked: { _id: "r1" },
    });
    const ctx = { db };

    await expect(
      pollAgentUpdate.handler(ctx as any, {
        token: "hsb_x",
        connectionId: "cid",
      }),
    ).resolves.toEqual({
      updateRequested: false,
      targetVersion: null,
      revoked: true,
    });
    // Revogado → não ressuscita heartbeat.
    expect(db.patch).not.toHaveBeenCalled();
  });

  it("reports revoked:true when the row was force-disconnected as user_revoked", async () => {
    const db = pollDb({
      token: { user_id: "user-1" },
      connection: {
        _id: "conn1",
        user_id: "user-1",
        connection_name: "kali-x",
        status: "disconnected",
        disconnect_reason: "user_revoked",
      },
      revoked: null,
    });
    const ctx = { db };

    await expect(
      pollAgentUpdate.handler(ctx as any, {
        token: "hsb_x",
        connectionId: "cid",
      }),
    ).resolves.toEqual({
      updateRequested: false,
      targetVersion: null,
      revoked: true,
    });
    expect(db.patch).not.toHaveBeenCalled();
  });

  it("invalid token → no-op (no revoke, no heartbeat)", async () => {
    const db = pollDb({ token: null, connection: null, revoked: null });
    const ctx = { db };

    await expect(
      pollAgentUpdate.handler(ctx as any, {
        token: "bad",
        connectionId: "cid",
      }),
    ).resolves.toEqual({
      updateRequested: false,
      targetVersion: null,
      revoked: false,
    });
    expect(db.patch).not.toHaveBeenCalled();
  });
});

describe("connector revocation list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authed.getUserIdentity.mockResolvedValue({ subject: "user-1" });
  });

  it("dismiss marks the row (keeps it) instead of deleting — stays blocked", async () => {
    const first = jest
      .fn<any>()
      .mockResolvedValue({ _id: "r1", dismissed_at: undefined });
    const { query } = queryReturning({ first });
    const patch = jest.fn<any>().mockResolvedValue(undefined);
    const del = jest.fn<any>();
    const ctx = { auth: authed, db: { query, patch, delete: del } };

    await expect(
      dismissRevokedConnector.handler(ctx as any, {
        connectionName: "kali-x",
      }),
    ).resolves.toEqual({ success: true });

    // Dispensar NÃO apaga a linha → isConnectorRevoked (presença da linha)
    // continua true → a máquina segue bloqueada de reconectar.
    expect(patch).toHaveBeenCalledWith("r1", {
      dismissed_at: expect.any(Number),
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("dismiss is idempotent (already dismissed → no write)", async () => {
    const first = jest
      .fn<any>()
      .mockResolvedValue({ _id: "r1", dismissed_at: 123 });
    const { query } = queryReturning({ first });
    const patch = jest.fn<any>();
    const ctx = { auth: authed, db: { query, patch } };

    await dismissRevokedConnector.handler(ctx as any, {
      connectionName: "kali-x",
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("dismiss no-ops when there is no revoked row", async () => {
    const first = jest.fn<any>().mockResolvedValue(null);
    const { query } = queryReturning({ first });
    const patch = jest.fn<any>();
    const ctx = { auth: authed, db: { query, patch } };

    await expect(
      dismissRevokedConnector.handler(ctx as any, {
        connectionName: "ghost",
      }),
    ).resolves.toEqual({ success: true });
    expect(patch).not.toHaveBeenCalled();
  });

  it("re-revoking a dismissed machine un-dismisses it (back to visible list)", async () => {
    const db = revokeDb({
      connection: {
        _id: "conn1",
        user_id: "user-1",
        connection_name: "kali-x",
        status: "disconnected",
      },
      revoked: { _id: "r1", dismissed_at: 999 },
    });
    const ctx = { auth: authed, db };

    await expect(
      revokeConnection.handler(ctx as any, { connectionId: "cid" }),
    ).resolves.toEqual({ success: true });

    // Traz de volta para a lista (limpa o dismiss) e atualiza o horário; não
    // insere uma segunda linha porque já existia.
    expect(db.patch).toHaveBeenCalledWith("r1", {
      dismissed_at: undefined,
      revoked_at: expect.any(Number),
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("'allow again' (unrevoke) DELETES the row — re-enables reconnect", async () => {
    const first = jest.fn<any>().mockResolvedValue({ _id: "r1" });
    const { query } = queryReturning({ first });
    const del = jest.fn<any>().mockResolvedValue(undefined);
    const ctx = { auth: authed, db: { query, delete: del } };

    await unrevokeConnection.handler(ctx as any, { connectionName: "kali-x" });
    expect(del).toHaveBeenCalledWith("r1");
  });

  it("list hides dismissed rows but keeps the still-visible ones", async () => {
    const collect = jest.fn<any>().mockResolvedValue([
      { connection_name: "a", revoked_at: 2, dismissed_at: undefined },
      { connection_name: "b", revoked_at: 1, dismissed_at: 5 },
    ]);
    const { query } = queryReturning({ collect });
    const ctx = { auth: authed, db: { query } };

    await expect(
      listRevokedConnectors.handler(ctx as any, {}),
    ).resolves.toEqual([{ connectionName: "a", revokedAt: 2 }]);
  });
});
