import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth';
import { validateResetToken, consumeResetToken } from '@/lib/auth-tokens';
import { unwrapWithZKSecret, wrapKey, deriveKeyFromPassword } from '@/lib/crypto';
import { randomBytes } from 'crypto';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { auditEvent } from '@/lib/audit';
import { sendMail } from '@/lib/mail';
import { securityNoticeMail } from '@/lib/mail-templates';

const resetSchema = z
  .object({
    token: z.string().length(64),
    zkSecret: z.string().min(43).max(44),
    newPassword: z.string().min(12, 'Password minima 12 caratteri'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Le password non coincidono',
    path: ['confirmPassword'],
  });

// Reset password per utenti Zero-Knowledge: richiede il secret di recupero
// (nessun fallback via email/server). Uniforme su token/chiave non validi.
export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

  const rlIp = checkRateLimit(`zk-reset:ip:${ip}`, 5, 15 * 60 * 1000);
  if (!rlIp.allowed) {
    return fail('Troppe richieste, riprova più tardi', 429);
  }

  let body: z.infer<typeof resetSchema>;
  try {
    body = resetSchema.parse(await request.json());
  } catch (e) {
    if (e instanceof z.ZodError) return fail(e.issues[0].message, 400);
    return fail('Dati non validi', 400);
  }

  const validation = await validateResetToken(body.token);

  if (validation?.user) {
    // Quota anti mail-bombing per destinatario.
    const rlEmail = checkRateLimit(`zk-reset:email:${validation.user.email}`, 3, 60 * 60 * 1000);
    if (!rlEmail.allowed) {
      return fail('Troppe richieste per questa email, riprova più tardi', 429);
    }
  }

  if (!validation?.user || !validation.user.zeroKnowledgeEnabled) {
    // Confronto fittizio per tempi uniformi (nessun oracolo su token/esistenza).
    try {
      await unwrapWithZKSecret(
        {
          zeroKnowledgeMode: true,
          zkSalt: Buffer.alloc(16).toString('base64'),
          wSys: 'dummy',
        },
        body.zkSecret
      );
    } catch {
      // atteso
    }
    return fail('Token non valido o scaduto', 400);
  }

  const userKey = validation.user.userKey;
  if (!userKey || !userKey.zeroKnowledgeMode) {
    return fail('Token non valido o scaduto', 400);
  }

  let dek: Buffer;
  try {
    dek = await unwrapWithZKSecret(userKey, body.zkSecret);
  } catch {
    return fail('Chiave di recupero non valida', 400);
  }

  const consumed = await consumeResetToken(body.token);
  if (!consumed) {
    return fail('Token non valido o già usato', 400);
  }

  // Riavvolge la DEK (invariata) con la nuova password; W_sys resta invariato.
  const argon2Salt = randomBytes(16);
  const newPwdKey = await deriveKeyFromPassword(body.newPassword, argon2Salt);
  const wPwd = wrapKey(dek, newPwdKey);

  const updatedUser = await prisma.user.update({
    where: { id: validation.user.id },
    data: {
      passwordHash: await hashPassword(body.newPassword),
      sessionVersion: { increment: 1 },
    },
  });

  await prisma.userKey.update({
    where: { userId: validation.user.id },
    data: {
      wPwd,
      argon2Salt: argon2Salt.toString('base64'),
      version: { increment: 1 },
    },
  });

  await prisma.authToken.deleteMany({ where: { userId: validation.user.id } });

  auditEvent({
    type: 'auth.zk_password_reset',
    actor: validation.user.id,
    target: validation.user.id,
    ip,
  });

  // Avviso di sicurezza (come per il reset non-ZK): best-effort, non blocca la risposta.
  void sendMail({
    to: updatedUser.email,
    ...securityNoticeMail(
      updatedUser.name,
      `la password del tuo account (Modalità Zero-Knowledge) è stata modificata il ${new Date().toLocaleString('it-IT')}.`
    ),
  });

  return NextResponse.json({ ok: true });
}
