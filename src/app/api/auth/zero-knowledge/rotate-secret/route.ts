import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions, verifyPasswordConstantTime } from '@/lib/auth';
import { unwrapWithPassword, wrapDekForZKSecret } from '@/lib/crypto';
import { createZkPendingToken, verifyZkPendingToken } from '@/lib/zk-pending';
import { auditEvent } from '@/lib/audit';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { randomBytes } from 'crypto';

// Rotazione in due fasi, autorizzata dalla password corrente (step-up):
// chi conosce la password ha già accesso ai dati (la DEK è sbloccabile via
// W_pwd), quindi non serve la vecchia chiave di recupero. Così anche chi ha
// perso la chiave può generarne una nuova restando loggato.
//  - action "prepare": verifica la password, ricava la DEK, genera nuovo
//    secret + W_sys/zkSalt. NESSUNA scrittura; restituisce nuova chiave + pendingToken.
//  - action "confirm": verifica il pendingToken e committa la rotazione.
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('prepare'),
    password: z.string().min(12),
  }),
  z.object({
    action: z.literal('confirm'),
    pendingToken: z.string().min(1),
  }),
]);

export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

  const rl = checkRateLimit(`zk-rotate:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) return fail('Troppe richieste, riprova più tardi', 429);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
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

    const userKey = user.userKey;
    if (!userKey || !userKey.zeroKnowledgeMode) {
      return fail('Modalità Zero-Knowledge non attiva', 409);
    }

    // ---- Fase 1: preparazione (nessuna scrittura) ----
    if (body.action === 'prepare') {
      if (!(await verifyPasswordConstantTime(body.password, user.passwordHash))) {
        return fail('Password non valida', 401);
      }
      let dek: Buffer;
      try {
        dek = await unwrapWithPassword(userKey, body.password);
      } catch {
        return fail('Password non valida', 401);
      }

      const newSecret = randomBytes(32).toString('base64url');
      const { wSys, zkSalt } = await wrapDekForZKSecret(dek, newSecret);
      const pendingToken = await createZkPendingToken({
        userId,
        purpose: 'zk-rotate',
        wSys,
        zkSalt: zkSalt.toString('base64'),
      });

      return NextResponse.json({
        ok: true,
        newRecoveryKey: newSecret,
        pendingToken,
        message:
          'Salva la nuova chiave in luogo sicuro, poi conferma. La precedente smetterà di funzionare.',
      });
    }

    // ---- Fase 2: conferma (commit) ----
    const pending = await verifyZkPendingToken(body.pendingToken, {
      userId,
      purpose: 'zk-rotate',
    });
    if (!pending) return fail('Conferma non valida o scaduta. Ricomincia e genera una nuova chiave.', 400);

    await prisma.userKey.update({
      where: { userId },
      data: {
        wSys: pending.wSys,
        zkSalt: pending.zkSalt,
        version: { increment: 1 },
      },
    });

    // La rotazione NON invalida i token di reset in sospeso: il token è
    // indipendente dalla chiave (che viene inserita al momento del reset).
    auditEvent({ type: 'auth.zk_secret_rotated', actor: userId, target: userId, ip });

    return NextResponse.json({
      ok: true,
      message: 'Chiave di recupero aggiornata. La precedente non è più valida.',
    });
  } catch (error) {
    console.error('Error rotating ZK secret:', error);
    return fail('Errore durante la generazione della nuova chiave', 500);
  }
}
