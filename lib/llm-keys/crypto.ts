/**
 * Criptografia das chaves de API do pool de LLM (AES-256-GCM).
 *
 * server-only de fato: usa `node:crypto`, que não existe no bundle de
 * cliente/edge (importar no cliente quebra o build) nem no runtime V8 do Convex.
 * Por isso a cifragem acontece AQUI (rotas /api/admin e o hook de saída do
 * provider, ambos Node), NUNCA no Convex. O banco guarda só o texto cifrado +
 * iv + authTag; o segredo-mestre vive só no env de produção.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SALT = "suricatoos-llm-key-pool-v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.LLM_KEY_ENC_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "LLM_KEY_ENC_SECRET ausente ou curto (>=16 chars) — necessário para o pool de chaves de LLM",
    );
  }
  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

/** Cifra um segredo (chave de API) com AES-256-GCM; IV aleatório por cifragem. */
export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Decifra; lança se o authTag não bater (dado adulterado ou segredo errado). */
export function decryptSecret(p: EncryptedSecret): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(p.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(p.authTag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(p.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Últimos 4 chars, para identificar a chave na UI sem expor o valor. */
export function last4(secret: string): string {
  return secret.length <= 4 ? secret : secret.slice(-4);
}

/** Só para testes: limpa o cache da chave derivada (após mudar o env). */
export function __resetKeyCacheForTests(): void {
  cachedKey = null;
}
