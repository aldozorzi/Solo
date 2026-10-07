import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth';
import { authOptions } from '@/lib/auth';
import { isValidCodiceFiscale, isValidPartitaIVA } from '@/lib/fiscal-code';

const registerSchema = z.object({
  email: z.string().email('Email non valida'),
  name: z.string().min(1, 'Nome obbligatorio'),
  password: z.string().min(8, 'Password minima 8 caratteri'),
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
    
    if (userCount > 0) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id || session.user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Registrazione non consentita: utenti già esistenti' }, { status: 403 });
      }
    }

    const body = await request.json();
    const data = registerSchema.parse(body);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Email già registrata' }, { status: 400 });
    }

    const passwordHash = await hashPassword(data.password);

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
        createdAt: true,
      },
    });

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