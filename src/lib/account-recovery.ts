import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type RecoveryTokenType = "setup" | "password_reset" | "mfa_reset";

const TTL_MS: Record<RecoveryTokenType, number> = {
  setup: 24 * 60 * 60 * 1000,
  password_reset: 15 * 60 * 1000,
  mfa_reset: 15 * 60 * 1000,
};

export function hashRecoveryToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Crea un token monouso: nel DB resta solo l'hash, il valore in chiaro
// viaggia unicamente nell'email. Invalida i precedenti dello stesso tipo.
export async function createRecoveryToken(
  userId: string,
  type: RecoveryTokenType
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.authToken.deleteMany({ where: { userId, type } });
  await prisma.authToken.create({
    data: {
      userId,
      type,
      tokenHash: hashRecoveryToken(token),
      expiresAt: new Date(Date.now() + TTL_MS[type]),
    },
  });
  return token;
}

// Consuma il token in modo atomico: valido solo se non usato, non scaduto
// e del tipo atteso. Ritorna { userId, type } oppure null (risposta uniforme).
// Accetta anche una lista di tipi (es. setup e reset condividono il form).
export async function consumeRecoveryToken(
  token: string,
  types: RecoveryTokenType | RecoveryTokenType[]
): Promise<{ userId: string; type: RecoveryTokenType } | null> {
  if (!token || typeof token !== "string") return null;
  const wanted = Array.isArray(types) ? types : [types];
  const row = await prisma.authToken.findUnique({
    where: { tokenHash: hashRecoveryToken(token) },
  });
  if (
    !row ||
    !wanted.includes(row.type as RecoveryTokenType) ||
    row.usedAt ||
    row.expiresAt.getTime() < Date.now()
  ) {
    return null;
  }
  const claimed = await prisma.authToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  return { userId: row.userId, type: row.type as RecoveryTokenType };
}

export async function invalidateUserRecoveryTokens(userId: string): Promise<void> {
  await prisma.authToken.deleteMany({ where: { userId } });
}
