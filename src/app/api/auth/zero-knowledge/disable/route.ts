import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions, verifyPasswordConstantTime } from '@/lib/auth';
import { unwrapWithPassword, wrapKey, MASTER_KEY } from '@/lib/crypto';
import { auditEvent } from '@/lib/audit';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';

// Disattivazione autorizzata dalla password corrente (step-up): la DEK è
// sbloccabile via W_pwd + password, quindi non serve la chiave di recupero.
const disableSchema = z.object({
  password: z.string().min(12),
});

export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

  const rl = checkRateLimit(`zk-disable:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) return fail('Troppe richieste, riprova più tardi', 429);

  let body: { password: string };
  try {
    body = disableSchema.parse(await request.json());
  } catch (e) {
    if (e instanceof z.ZodError) return fail(e.issues[0].message, 400);
    return fail('Dati non validi', 400);
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return fail('Non autenticato', 401);
  const userId = session.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { userKey: true },
    });
    if (!user) return fail('Utente non trovato', 404);
    if (!user.zeroKnowledgeEnabled) return fail('Modalità Zero-Knowledge non attiva', 409);

    if (!(await verifyPasswordConstantTime(body.password, user.passwordHash))) {
      return fail('Password non valida', 401);
    }

    const userKey = user.userKey;
    if (!userKey || !userKey.zeroKnowledgeMode) {
      return fail('Modalità Zero-Knowledge non attiva', 409);
    }

    let dek: Buffer;
    try {
      dek = await unwrapWithPassword(userKey, body.password);
    } catch {
      return fail('Password non valida', 401);
    }

    const wSys = wrapKey(dek, MASTER_KEY);

    await prisma.userKey.update({
      where: { userId },
      data: {
        wSys,
        zeroKnowledgeMode: false,
        zkSalt: null,
        version: { increment: 1 },
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        zeroKnowledgeEnabled: false,
        zeroKnowledgeActivatedAt: null,
      },
    });

    // I token di reset in sospeso restano validi (la pagina di reset si adatta
    // allo stato ZK/non-ZK corrente).
    auditEvent({ type: 'auth.zk_disabled', actor: userId, target: userId, ip });

    return NextResponse.json({
      ok: true,
      message: 'Modalità Zero-Knowledge disattivata. Ripristinato recovery standard via email.',
    });
  } catch (error) {
    console.error('Error disabling ZK mode:', error);
    return fail('Errore durante la disattivazione', 500);
  }
}
