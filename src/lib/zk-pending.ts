import { encode, decode, type JWT } from 'next-auth/jwt';

// Token "pending" a breve scadenza per il commit a due fasi delle operazioni ZK.
// È un JWE firmato/cifrato con NEXTAUTH_SECRET: il payload (wSys/zkSalt) non è
// leggibile dal client e il token è vincolato all'utente di sessione (sub) e
// all'operazione (purpose). Vale solo per la conferma finale dell'utente.
const TTL_SECONDS = 10 * 60; // 10 minuti

export type ZkPendingPurpose = 'zk-enable' | 'zk-rotate';

export interface ZkPendingPayload {
  userId: string;
  purpose: ZkPendingPurpose;
  wSys: string;
  zkSalt: string;
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET non configurata');
  return s;
}

export async function createZkPendingToken(payload: ZkPendingPayload): Promise<string> {
  return encode({
    token: {
      sub: payload.userId,
      purpose: payload.purpose,
      wSys: payload.wSys,
      zkSalt: payload.zkSalt,
    } as unknown as JWT,
    secret: secret(),
    maxAge: TTL_SECONDS,
  });
}

/**
 * Verifica il token pending: firma/decifratura, scadenza, utente e purpose.
 * Ritorna il materiale da committare oppure null.
 */
export async function verifyZkPendingToken(
  token: string,
  expected: { userId: string; purpose: ZkPendingPurpose }
): Promise<{ wSys: string; zkSalt: string } | null> {
  try {
    const decoded = (await decode({ token, secret: secret() })) as {
      sub?: string;
      purpose?: string;
      wSys?: unknown;
      zkSalt?: unknown;
    } | null;
    if (!decoded) return null;
    if (decoded.sub !== expected.userId) return null;
    if (decoded.purpose !== expected.purpose) return null;
    if (typeof decoded.wSys !== 'string' || typeof decoded.zkSalt !== 'string') return null;
    return { wSys: decoded.wSys, zkSalt: decoded.zkSalt };
  } catch {
    return null;
  }
}
