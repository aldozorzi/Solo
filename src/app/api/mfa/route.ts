import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { hashPassword } from '@/lib/auth';
import { openSecret, sealSecret } from '@/lib/secret-box';
import { buildOtpAuthUrl, generateBackupCodes, generateTotpSecret, verifyTotpCode } from '@/lib/totp';
import { checkRateLimit, clientIpFromHeaders } from '@/lib/rate-limit';
import { auditEvent } from '@/lib/audit';

const actionSchema = z.object({
  action: z.enum(['setup', 'enable', 'disable', 'backup-codes']),
  code: z.string().optional(),
});

async function getUserId(request: NextRequest): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  // Rate limit blando anche sugli endpoint autenticati (anti brute-force codici TOTP).
  const ip = clientIpFromHeaders(request.headers);
  const rl = checkRateLimit(`mfa:${ip}`, 20, 10 * 60 * 1000);
  if (!rl.allowed) {
    throw new Error('Troppe richieste');
  }
  return session.user.id;
}

async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => hashPassword(code)));
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { totpEnabled: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 });
    }
    return NextResponse.json({ enabled: user.totpEnabled });
  } catch (error) {
    console.error('Error in /api/mfa:', error);
    return NextResponse.json({ error: 'Errore 2FA' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId(request);
    const body = await request.json();
    const data = actionSchema.parse(body);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 });
    }

    if (data.action === 'setup') {
      if (user.totpEnabled) {
        return NextResponse.json({ error: 'Verifica in due passaggi già attiva' }, { status: 400 });
      }
      const secret = generateTotpSecret();
      await prisma.user.update({
        where: { id: userId },
        data: { totpSecret: sealSecret(secret) },
      });
      return NextResponse.json({
        secret,
        otpauthUrl: buildOtpAuthUrl(secret, user.email),
      });
    }

    if (data.action === 'enable') {
      if (user.totpEnabled) {
        return NextResponse.json({ error: 'Verifica in due passaggi già attiva' }, { status: 400 });
      }
      if (!user.totpSecret || !data.code || !verifyTotpCode(await openSecret(user.totpSecret), data.code)) {
        return NextResponse.json({ error: 'Codice non valido' }, { status: 400 });
      }
      const codes = generateBackupCodes();
      await prisma.user.update({
        where: { id: userId },
        data: { totpEnabled: true, totpBackupCodes: await hashBackupCodes(codes) },
      });
      auditEvent({ type: 'user.mfa_enabled', actor: userId, target: userId });
      // I codici in chiaro vengono mostrati UNA sola volta: nel DB restano solo gli hash.
      return NextResponse.json({ backupCodes: codes });
    }

    if (data.action === 'disable') {
      if (!user.totpEnabled || !user.totpSecret) {
        return NextResponse.json({ error: 'Verifica in due passaggi non attiva' }, { status: 400 });
      }
      // Solo codice TOTP (non backup code) per disattivare.
      if (!data.code || !verifyTotpCode(await openSecret(user.totpSecret), data.code)) {
        return NextResponse.json({ error: 'Codice non valido' }, { status: 400 });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { totpSecret: null, totpEnabled: false, totpBackupCodes: [] },
      });
      auditEvent({ type: 'user.mfa_disabled', actor: userId, target: userId });
      return NextResponse.json({ success: true });
    }

    // backup-codes: rigenera (richiede codice TOTP valido, mai un backup code).
    if (!user.totpEnabled || !user.totpSecret) {
      return NextResponse.json({ error: 'Verifica in due passaggi non attiva' }, { status: 400 });
    }
    if (!data.code || !verifyTotpCode(await openSecret(user.totpSecret), data.code)) {
      return NextResponse.json({ error: 'Codice non valido' }, { status: 400 });
    }
    const codes = generateBackupCodes();
    await prisma.user.update({
      where: { id: userId },
      data: { totpBackupCodes: await hashBackupCodes(codes) },
    });
    auditEvent({ type: 'user.mfa_enabled', actor: userId, target: userId, details: { regenerated: true } });
    return NextResponse.json({ backupCodes: codes });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error) {
      if (error.message === 'Non autenticato') {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      if (error.message === 'Troppe richieste') {
        return NextResponse.json({ error: error.message }, { status: 429 });
      }
    }
    console.error('Error in /api/mfa:', error);
    return NextResponse.json({ error: 'Errore 2FA' }, { status: 500 });
  }
}
