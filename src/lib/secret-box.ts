import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Cifratura simmetrica (AES-256-GCM) per i segreti TOTP a riposo.
// Chiave derivata da NEXTAUTH_SECRET: se il secret ruota, i segreti esistenti
// diventano illeggibili e vanno reinseriti (documentato in docs/SECURITY.md).
const PREFIX = "v1";

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET non configurata");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), ciphertext.toString("base64"), tag.toString("base64")].join(
    "."
  );
}

export function openSecret(sealed: string): string {
  const [prefix, ivB64, ctB64, tagB64] = sealed.split(".");
  if (prefix !== PREFIX || !ivB64 || !ctB64 || !tagB64) {
    throw new Error("Segreto in formato non valido");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
