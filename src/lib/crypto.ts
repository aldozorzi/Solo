import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import argon2 from 'argon2';

// -----------------------------------------------------------------------------
// CONFIGURAZIONE & COSTANTI
// -----------------------------------------------------------------------------

const AES_ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function loadMasterKey(): Buffer {
  const b64 = process.env.MASTER_KEY;
  if (!b64) {
    throw new Error("MASTER_KEY non configurata nelle variabili d'ambiente (base64, 32 byte)");
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY deve essere esattamente di 32 byte (44 caratteri base64)');
  }
  return key;
}

// Master Key di sistema: avvolge W_sys degli utenti NON-Zero-Knowledge.
export const MASTER_KEY: Buffer = loadMasterKey();

// -----------------------------------------------------------------------------
// TIPI
// -----------------------------------------------------------------------------

export type EncryptedField = {
  ciphertext: string;
  iv: string;
};

// Riga UserKey come vive nel DB (o il sottoinsieme necessario).
export type UserKeyRecord = {
  argon2Salt: string;
  wPwd: string;
  wSys: string;
  version?: number;
  zeroKnowledgeMode?: boolean;
  zkSalt?: string | null;
};

// -----------------------------------------------------------------------------
// HELPER INTERNI (PACK / UNPACK & DERIVAZIONE CHIAVI)
// -----------------------------------------------------------------------------

function pack(ciphertext: Buffer, iv: Buffer, authTag: Buffer): string {
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

function unpack(packed: string): { iv: Buffer; ciphertext: Buffer; authTag: Buffer } {
  const buf = Buffer.from(packed, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Dato cifrato corrotto: payload troppo corto');
  }
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  return { iv, ciphertext, authTag };
}

/**
 * Deriva una chiave AES-256 da una password/passphrase con Argon2id.
 */
export async function deriveKeyFromPassword(password: string, salt: Buffer): Promise<Buffer> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16, // 64 MB
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
    salt,
    raw: true,
  });
}

/**
 * Avvolge (cifra) una chiave con un'altra chiave AES-256-GCM.
 * Formato: base64(IV || ciphertext || authTag).
 */
export function wrapKey(key: Buffer, wrappingKey: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(AES_ALGO, wrappingKey, iv);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return pack(ciphertext, iv, authTag);
}

/**
 * Svolge (decifra) una chiave avvolta con un'altra chiave AES-256-GCM.
 */
export function unwrapKey(wrapped: string, wrappingKey: Buffer): Buffer {
  const { iv, ciphertext, authTag } = unpack(wrapped);
  const decipher = createDecipheriv(AES_ALGO, wrappingKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// -----------------------------------------------------------------------------
// CIFRATURA / DECIFRATURA CAMPI
// -----------------------------------------------------------------------------

/**
 * Cifra un campo stringa con la DEK utente.
 */
export function encryptField(plaintext: string, dek: Buffer): EncryptedField {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(AES_ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: pack(ciphertext, iv, authTag),
    iv: iv.toString('base64'),
  };
}

/**
 * Decifra un campo stringa con la DEK utente.
 *
 * Supporta due formati a riposo:
 *  - corrente: `ciphertext = base64(IV || ct || tag)` (IV ridondante in `enc.iv`);
 *  - legacy:   `ciphertext = base64(ct || tag)` con IV separato in `enc.iv`.
 * Il fallback legacy garantisce la lettura dei dati creati dalle versioni
 * precedenti senza migrazione distruttiva.
 */
export function decryptField(enc: EncryptedField, dek: Buffer): string {
  let primaryError: unknown;
  try {
    return unwrapKey(enc.ciphertext, dek).toString('utf8');
  } catch (err) {
    primaryError = err;
  }

  // Fallback formato legacy.
  if (!enc.iv) throw primaryError;
  const iv = Buffer.from(enc.iv, 'base64');
  if (iv.length !== IV_LEN) throw primaryError;
  const buf = Buffer.from(enc.ciphertext, 'base64');
  if (buf.length < TAG_LEN) throw primaryError;
  const authTag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(0, buf.length - TAG_LEN);
  const decipher = createDecipheriv(AES_ALGO, dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// -----------------------------------------------------------------------------
// GENERAZIONE CHIAVI UTENTE
// -----------------------------------------------------------------------------

/**
 * Genera una nuova DEK per un utente Standard (NON-ZK).
 * - wPwd: DEK avvolta con la chiave derivata dalla password (Argon2id).
 * - wSys: DEK avvolta con la MASTER_KEY di sistema (recovery via email).
 */
export async function generateUserKey(password: string): Promise<{
  dek: Buffer;
  wPwd: string;
  wSys: string;
  argon2Salt: Buffer;
}> {
  const dek = randomBytes(32);
  const argon2Salt = randomBytes(16);

  const pwdKey = await deriveKeyFromPassword(password, argon2Salt);
  const wPwd = wrapKey(dek, pwdKey);
  const wSys = wrapKey(dek, MASTER_KEY);

  return { dek, wPwd, wSys, argon2Salt };
}

/**
 * Crea una UserKey "pending" per migrazione dati legacy: nessuna password nota.
 * W_pwd contiene un involucro fittizio (identico a W_sys); l'utente otterrà un
 * W_pwd valido al primo reset password via email (unwrappa W_sys con MASTER_KEY).
 */
export function createPendingUserKey(): {
  dek: Buffer;
  wPwd: string;
  wSys: string;
  argon2Salt: Buffer;
} {
  const dek = randomBytes(32);
  const argon2Salt = randomBytes(16);
  const wSys = wrapKey(dek, MASTER_KEY);
  return { dek, wPwd: wSys, wSys, argon2Salt };
}

// -----------------------------------------------------------------------------
// SBLOCCAGGIO DELLA DEK
// -----------------------------------------------------------------------------

/**
 * Sblocca la DEK usando la password (vale per utenti Standard e ZK).
 */
export async function unwrapWithPassword(
  userKey: { argon2Salt: string; wPwd: string },
  password: string
): Promise<Buffer> {
  const salt = Buffer.from(userKey.argon2Salt, 'base64');
  const pwdKey = await deriveKeyFromPassword(password, salt);
  return unwrapKey(userKey.wPwd, pwdKey);
}

/**
 * Sblocca la DEK usando la MASTER_KEY (solo utenti NON-ZK).
 */
export async function unwrapWithMasterKey(
  userKey: { wSys: string; zeroKnowledgeMode?: boolean }
): Promise<Buffer> {
  if (userKey.zeroKnowledgeMode) {
    throw new Error('Operazione negata: impossibile usare MASTER_KEY su account Zero-Knowledge.');
  }
  return unwrapKey(userKey.wSys, MASTER_KEY);
}

/**
 * Sblocca la DEK usando il secret ZK (solo utenti Zero-Knowledge).
 */
export async function unwrapWithZKSecret(
  userKey: { wSys: string; zkSalt?: string | null; zeroKnowledgeMode?: boolean },
  userSecret: string
): Promise<Buffer> {
  if (!userKey.zeroKnowledgeMode) {
    throw new Error("Operazione negata: l'utente non è in modalità Zero-Knowledge.");
  }
  if (!userKey.zkSalt) {
    throw new Error("Errore di integrità: zkSalt mancante per l'account ZK.");
  }
  const salt = Buffer.from(userKey.zkSalt, 'base64');
  const zkKey = await deriveKeyFromPassword(userSecret, salt);
  return unwrapKey(userKey.wSys, zkKey);
}

/**
 * Aliases storici mantenuti per chiarezza negli endpoint ZK.
 */
export const unwrapZKKey = unwrapWithZKSecret;

/**
 * Avvolge una DEK esistente con un secret ZK: produce W_sys + zkSalt.
 * Non genera una nuova DEK (i dati restano decifrabili con la stessa chiave).
 */
export async function wrapDekForZKSecret(
  dek: Buffer,
  userSecret: string
): Promise<{ wSys: string; zkSalt: Buffer }> {
  const zkSalt = randomBytes(16);
  const zkKey = await deriveKeyFromPassword(userSecret, zkSalt);
  const wSys = wrapKey(dek, zkKey);
  return { wSys, zkSalt };
}

/**
 * Ri-avvolge la DEK con una nuova password (reset password via email, utenti NON-ZK).
 * Non richiede la vecchia password: sblocca W_sys con la MASTER_KEY.
 */
export async function rewrapUserKeyOnPasswordReset(
  userKey: { wSys: string; zeroKnowledgeMode?: boolean },
  newPassword: string
): Promise<{ wPwd: string; argon2Salt: Buffer }> {
  const dek = await unwrapWithMasterKey(userKey);
  const argon2Salt = randomBytes(16);
  const newPwdKey = await deriveKeyFromPassword(newPassword, argon2Salt);
  const wPwd = wrapKey(dek, newPwdKey);
  return { wPwd, argon2Salt };
}

/**
 * Ri-avvolge la DEK con un nuovo secret ZK (rotazione chiave di recupero).
 */
export async function rewrapZKKey(
  userKey: { wSys: string; zkSalt: string; zeroKnowledgeMode?: boolean },
  oldSecret: string,
  newSecret: string
): Promise<{ wSys: string; zkSalt: Buffer }> {
  const dek = await unwrapWithZKSecret(userKey, oldSecret);
  return wrapDekForZKSecret(dek, newSecret);
}

export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}
