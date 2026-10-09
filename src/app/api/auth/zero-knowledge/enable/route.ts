import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { unwrapWithMasterKey, wrapDekForZKSecret } from '@/lib/crypto';
import { createZkPendingToken, verifyZkPendingToken } from '@/lib/zk-pending';
import { auditEvent } from '@/lib/audit';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { randomBytes } from 'crypto';

// Attivazione ZK in due fasi:
//  - action "prepare": genera secret + W_sys/zkSalt ma NON modifica nulla;
//    restituisce la chiave (da salvare) e un pendingToken a breve scadenza.
//  - action "confirm": l'utente clicca "ATTIVA"; verifica il pendingToken e
//    solo allora committa l'attivazione.
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare') }),
  z.object({
    action: z.literal('confirm'),
    pendingToken: z.string().min(1),
    confirmDisclaimer: z
      .boolean()
      .refine((v) => v === true, 'Devi confermare di aver salvato la chiave'),
  }),
]);

export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

  const rl = checkRateLimit(`zk-enable:${ip}`, 5, 60 * 60 * 1000);
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

    // ---- Fase 1: preparazione (nessuna scrittura) ----
    if (body.action === 'prepare') {
      if (user.zeroKnowledgeEnabled) return fail('Modalità Zero-Knowledge già attiva', 409);
      const userKey = user.userKey;
      if (!userKey) return fail('Chiave utente non trovata', 409);
      if (userKey.zeroKnowledgeMode) return fail('Modalità Zero-Knowledge già attiva', 409);

      // DEK esistente (non-ZK: W_sys è avvolta con MASTER_KEY), ri-avvolta con un
      // nuovo secret di recupero. La DEK resta invariata: W_pwd resta valido.
      const dek = await unwrapWithMasterKey(userKey);
      const userSecret = randomBytes(32).toString('base64url');
      const { wSys, zkSalt } = await wrapDekForZKSecret(dek, userSecret);
      const pendingToken = await createZkPendingToken({
        userId,
        purpose: 'zk-enable',
        wSys,
        zkSalt: zkSalt.toString('base64'),
      });

      return NextResponse.json({
        ok: true,
        recoveryKey: userSecret,
        pendingToken,
        message:
          'Salva la chiave in luogo sicuro, poi conferma per attivare. Fallo ORA: non sarà più mostrata.',
      });
    }

    // ---- Fase 2: conferma (commit) ----
    const pending = await verifyZkPendingToken(body.pendingToken, {
      userId,
      purpose: 'zk-enable',
    });
    if (!pending) return fail('Conferma non valida o scaduta. Ricomincia l\'attivazione.', 400);

    // Rilettura: niente attivazioni concorrenti/doppie.
    if (user.zeroKnowledgeEnabled) return fail('Modalità Zero-Knowledge già attiva', 409);

    await prisma.userKey.update({
      where: { userId },
      data: {
        wSys: pending.wSys,
        zeroKnowledgeMode: true,
        zkSalt: pending.zkSalt,
        version: { increment: 1 },
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        zeroKnowledgeEnabled: true,
        zeroKnowledgeActivatedAt: new Date(),
        // Nessun incremento di sessionVersion: la password e la DEK non cambiano.
      },
    });

    // Non cancelliamo i token di recupero in sospeso: l'attivazione ZK non li
    // rende invalidi (la pagina di reset si adatta da sola allo stato ZK).
    auditEvent({ type: 'auth.zk_enabled', actor: userId, target: userId, ip });

    return NextResponse.json({
      ok: true,
      message: 'Modalità Zero-Knowledge attivata.',
    });
  } catch (error) {
    console.error('Error enabling ZK mode:', error);
    return fail('Errore durante l\'attivazione', 500);
  }
}
