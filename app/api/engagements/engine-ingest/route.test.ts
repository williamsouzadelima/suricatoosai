import type { NextRequest } from "next/server";

import { captureEngineFinding } from "@/lib/engine/capture";
import { isEngineIngestEnabled, verifyEngineToken } from "@/lib/engine/config";
import { uploadEngineImage } from "@/lib/engine/upload-image";

// next/server precisa de globals (Request/Response) que o jsdom não expõe; o
// repo resolve mockando NextResponse (ver app/api/health/core/__tests__).
jest.mock("next/server", () => ({
  NextResponse: class MockNextResponse {
    status: number;
    headers: Headers;
    private body: unknown;
    constructor(body?: unknown, init?: ResponseInit) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(body, init);
    }
    async json() {
      return this.body;
    }
  },
}));

jest.mock("@/lib/engine/config", () => ({
  isEngineIngestEnabled: jest.fn(),
  verifyEngineToken: jest.fn(),
}));
jest.mock("@/lib/engine/upload-image", () => ({ uploadEngineImage: jest.fn() }));
jest.mock("@/lib/engine/capture", () => ({ captureEngineFinding: jest.fn() }));

// Importado DEPOIS dos mocks (o jest os iça, mas mantemos a ordem clara).
import { POST } from "./route";

const mEnabled = isEngineIngestEnabled as jest.Mock;
const mVerify = verifyEngineToken as jest.Mock;
const mUpload = uploadEngineImage as jest.Mock;
const mCapture = captureEngineFinding as jest.Mock;

function validPayload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    engagementId: "eng_1",
    userId: "user_1",
    title: "IDOR",
    affectedAsset: "api.x.com",
    weaknessClass: "idor",
    severity: "high",
    ...over,
  });
}

function makeReq(opts: { token?: string | null; fd?: FormData }): NextRequest {
  const headers = new Headers();
  if (opts.token != null) headers.set("x-engine-token", opts.token);
  return {
    headers,
    formData: async () => {
      if (!opts.fd) throw new Error("no form");
      return opts.fd;
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  mEnabled.mockReturnValue(true);
  mVerify.mockReturnValue(true);
  mCapture.mockResolvedValue({ success: true, merged: false, finding_id: "f1" });
});

describe("POST engine-ingest — sigilo", () => {
  it("404 quando desligado (recurso invisível)", async () => {
    mEnabled.mockReturnValue(false);
    const res = await POST(makeReq({ token: "tok" }));
    expect(res.status).toBe(404);
    expect(mCapture).not.toHaveBeenCalled();
  });

  it("404 quando token inválido (não revela o endpoint)", async () => {
    mVerify.mockReturnValue(false);
    const res = await POST(makeReq({ token: "x" }));
    expect(res.status).toBe(404);
    expect(mCapture).not.toHaveBeenCalled();
  });
});

describe("POST engine-ingest — orquestração", () => {
  it("grava achado sem imagens e devolve ok", async () => {
    const fd = new FormData();
    fd.set("payload", validPayload({ narrative: "# rel" }));
    const res = await POST(makeReq({ token: "tok", fd }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, finding_id: "f1", images: 0 });
    const arg = mCapture.mock.calls[0][0];
    expect(arg.origin).toBe("agent");
    expect(arg.severity).toBe("high");
    expect(arg.engagementId).toBe("eng_1");
    expect(arg.narrative).toBe("# rel");
    expect(arg.evidence).toEqual([]);
    expect(mUpload).not.toHaveBeenCalled();
  });

  it("sobe imagem declarada e a vincula como evidência file", async () => {
    mUpload.mockResolvedValue({
      file_id: "file_a",
      s3_key: "users/user_1/a.png",
      media_type: "image/png",
      size: 3,
    });
    const fd = new FormData();
    fd.set(
      "payload",
      validPayload({ images: [{ field: "img0", label: "XSS", tool_name: "browser" }] }),
    );
    const bytes = new Uint8Array([1, 2, 3]);
    const file = new File([bytes], "x.png", { type: "image/png" });
    // jsdom não implementa Blob/File.arrayBuffer() nesta versão; o runtime real
    // (undici/Node) implementa. Remendamos a instância (segue instanceof File).
    (file as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer =
      async () => bytes.buffer;
    fd.set("img0", file);
    const res = await POST(makeReq({ token: "tok", fd }));
    expect(res.status).toBe(200);
    expect(mUpload).toHaveBeenCalledTimes(1);
    const ev = mCapture.mock.calls[0][0].evidence;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      source_type: "file",
      file_id: "file_a",
      s3_key: "users/user_1/a.png",
      media_type: "image/png",
      label: "XSS",
    });
  });

  it("400 quando falta o campo payload", async () => {
    const res = await POST(makeReq({ token: "tok", fd: new FormData() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_payload");
  });

  it("400 em severidade desconhecida", async () => {
    const fd = new FormData();
    fd.set("payload", validPayload({ severity: "super-bad" }));
    const res = await POST(makeReq({ token: "tok", fd }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_severity");
    expect(mCapture).not.toHaveBeenCalled();
  });

  it("400 quando a imagem declarada não vem no multipart", async () => {
    const fd = new FormData();
    fd.set("payload", validPayload({ images: [{ field: "missing", label: "x" }] }));
    const res = await POST(makeReq({ token: "tok", fd }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_image");
  });
});
