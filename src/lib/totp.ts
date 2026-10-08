import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238, SHA-1, step 30s, 6 cifre) senza dipendenze esterne.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.trim().replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error("Segreto non valido (base32)");
  let bits = "";
  for (const char of clean) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

export function buildOtpAuthUrl(secret: string, account: string, issuer = "Solo"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secret: Buffer, counter: bigint): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return (code % 1_000_000).toString().padStart(6, "0");
}

export function totpAt(secretBase32: string, atMs: number = Date.now()): string {
  const secret = base32Decode(secretBase32);
  const counter = BigInt(Math.floor(atMs / 1000 / 30));
  return hotp(secret, counter);
}

export function verifyTotpCode(secretBase32: string, code: string, atMs: number = Date.now(), window = 1): boolean {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const counter = BigInt(Math.floor(atMs / 1000 / 30));
  for (let drift = -window; drift <= window; drift++) {
    const candidate = hotp(secret, counter + BigInt(drift));
    const a = Buffer.from(candidate, "utf8");
    const b = Buffer.from(normalized, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

// Codici di backup monouso in chiaro (da mostrare una sola volta);
// nel DB vanno salvati solo gli hash bcrypt.
export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = () => randomBytes(3).toString("hex").toUpperCase();
    codes.push(`${part()}-${part()}`);
  }
  return codes;
}
