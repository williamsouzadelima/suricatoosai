import {
  __resetKeyCacheForTests,
  decryptSecret,
  encryptSecret,
  last4,
} from "./crypto";

const prev = process.env.LLM_KEY_ENC_SECRET;

beforeEach(() => {
  process.env.LLM_KEY_ENC_SECRET = "test-master-secret-0123456789";
  __resetKeyCacheForTests();
});

afterAll(() => {
  if (prev === undefined) delete process.env.LLM_KEY_ENC_SECRET;
  else process.env.LLM_KEY_ENC_SECRET = prev;
  __resetKeyCacheForTests();
});

describe("crypto das chaves de LLM", () => {
  it("roundtrip encrypt→decrypt recupera o texto", () => {
    const plain = "sk-or-v1-abcdef0123456789";
    const enc = encryptSecret(plain);
    expect(enc.ciphertext).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("IV diferente a cada cifragem (ciphertexts distintos)", () => {
    const a = encryptSecret("mesma-chave");
    const b = encryptSecret("mesma-chave");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSecret(a)).toBe("mesma-chave");
    expect(decryptSecret(b)).toBe("mesma-chave");
  });

  it("authTag adulterado faz o decrypt lançar (integridade)", () => {
    const enc = encryptSecret("segredo");
    const tampered = { ...enc, authTag: Buffer.from("x".repeat(16)).toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("segredo-mestre diferente não decifra", () => {
    const enc = encryptSecret("segredo");
    process.env.LLM_KEY_ENC_SECRET = "outro-master-secret-9876543210";
    __resetKeyCacheForTests();
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("lança se o segredo-mestre faltar", () => {
    delete process.env.LLM_KEY_ENC_SECRET;
    __resetKeyCacheForTests();
    expect(() => encryptSecret("x")).toThrow(/LLM_KEY_ENC_SECRET/);
  });

  it("last4 expõe só os últimos 4", () => {
    expect(last4("sk-or-v1-abcdef1234")).toBe("1234");
    expect(last4("ab")).toBe("ab");
  });
});
