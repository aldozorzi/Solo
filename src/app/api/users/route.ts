import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '@/lib/auth';
import { authOptions } from '@/lib/auth';
import { auditEvent } from '@/lib/audit';
import { createRecoveryToken, invalidateUserRecoveryTokens } from '@/lib/account-recovery';
import { sendMail } from '@/lib/mail';
import { setupAccountMail } from '@/lib/mail-templates';
import { isValidCodiceFiscale, isValidPartitaIVA } from '@/lib/fiscal-code';

const registerSchema = z.object({
  email: z.string().email('Email non valida'),
  name: z.string().min(1, 'Nome obbligatorio'),
  // Obbligatoria solo al bootstrap (primo utente); dopo, la password iniziale
  // viene sempre impostata dall'utente via email: l'admin non la conosce mai.
  password: z.string().min(12, 'Password minima 12 caratteri').optional(),
  businessName: z.string().min(1, 'Denominazione obbligatoria'),
  vatNumber: z
    .string()
    .trim()
    .toUpperCase()
    .length(11, 'Partita IVA deve essere 11 cifre')
    .refine(isValidPartitaIVA, { message: 'Partita IVA non valida (codice di controllo errato)' }),
  taxCode: z
    .string()
    .trim()
    .toUpperCase()
    .length(16, 'Codice Fiscale deve essere 16 caratteri')
    .refine(isValidCodiceFiscale, { message: 'Codice Fiscale non valido (codice di controllo errato)' }),
  address: z.string().min(1, 'Indirizzo obbligatorio'),
  city: z.string().min(1, 'Comune obbligatorio'),
  zipCode: z.string().length(5, 'CAP deve essere 5 cifre'),
  province: z.string().length(2, 'Provincia (sigla, 2 caratteri)'),
  country: z.string().default('IT'),
  taxRegime: z.enum(['FORFETTARIO', 'ORDINARIO']).default('FORFETTARIO'),
  senderType: z.enum(['LIBERO_PROFESSIONISTA', 'DITTA_INDIVIDUALE', 'SOCIETA']).default('LIBERO_PROFESSIONISTA'),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
    }
    
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accesso negato: solo amministratori' }, { status: 403 });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        businessName: true,
        vatNumber: true,
        taxCode: true,
        address: true,
        city: true,
        zipCode: true,
        province: true,
        country: true,
        taxRegime: true,
        senderType: true,
        createdAt: true,
        _count: {
          select: { clients: true, invoices: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Errore nel recupero utenti' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userCount = await prisma.user.count();

    let actorId: string | undefined;
    if (userCount > 0) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id || session.user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Registrazione non consentita: utenti già esistenti' }, { status: 403 });
      }
      actorId = session.user.id;
    }

    const body = await request.json();
    const data = registerSchema.parse(body);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Email già registrata' }, { status: 400 });
    }

    if (userCount === 0 && !data.password) {
      return NextResponse.json({ error: 'Password obbligatoria per il primo utente' }, { status: 400 });
    }
    if (userCount > 0 && data.password) {
      // L'admin non imposta mai password altrui: solo invito via email.
      return NextResponse.json(
        { error: 'La password iniziale viene impostata dall\u2019utente via email di attivazione' },
        { status: 400 }
      );
    }

    const passwordHash =
      userCount === 0
        ? await hashPassword(data.password as string)
        : await hashPassword(randomBytes(32).toString('hex')); // account bloccato

    const role = userCount === 0 ? 'ADMIN' : 'USER';

    const user = await prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        passwordHash,
        role,
        businessName: data.businessName,
        vatNumber: data.vatNumber,
        taxCode: data.taxCode,
        address: data.address,
        city: data.city,
        zipCode: data.zipCode,
        province: data.province,
        country: data.country,
        taxRegime: data.taxRegime,
        senderType: data.senderType,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        businessName: true,
        vatNumber: true,
        taxCode: true,
        address: true,
        city: true,
        zipCode: true,
        province: true,
        country: true,
        taxRegime: true,
        senderType: true,
        createdAt: true,
      },
    });

    auditEvent({
      type: 'user.created',
      actor: actorId,
      target: user.id,
      details: { email: user.email, role: user.role },
    });

    // Account creati da admin: invito di attivazione via email (l'account nasce
    // bloccato). Se l'invio fallisce, rollback completo: niente account orfani.
    if (userCount > 0) {
      try {
        const token = await createRecoveryToken(user.id, 'setup');
        const { sent } = await sendMail({ to: user.email, ...setupAccountMail(user.name, token) });
        if (!sent) throw new Error('Invio email fallito');
        auditEvent({ type: 'auth.setup_invited', actor: actorId, target: user.id });
      } catch (error) {
        await invalidateUserRecoveryTokens(user.id).catch(() => undefined);
        await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
        console.error('Error sending setup invite, rolled back:', error);
        return NextResponse.json({ error: "Impossibile inviare l'email di attivazione" }, { status: 502 });
      }
    }

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join('; ') },
        { status: 400 }
      );
    }
    console.error('Error creating user:', error);
    return NextResponse.json({ error: 'Errore nella creazione utente' }, { status: 500 });
  }
}