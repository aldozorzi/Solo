import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth';
import { authOptions } from '@/lib/auth';
import { isValidCodiceFiscale, isValidPartitaIVA } from '@/lib/fiscal-code';

const userUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  // Niente campo role: il ruolo non è mai modificabile via API.
  // Il primo utente è ADMIN, tutti gli altri sono USER.
  businessName: z.string().min(1).optional(),
  vatNumber: z
    .string()
    .trim()
    .toUpperCase()
    .length(11, 'Partita IVA deve essere 11 cifre')
    .refine(isValidPartitaIVA, { message: 'Partita IVA non valida (codice di controllo errato)' })
    .optional(),
  taxCode: z
    .string()
    .trim()
    .toUpperCase()
    .length(16, 'Codice Fiscale deve essere 16 caratteri')
    .refine(isValidCodiceFiscale, { message: 'Codice Fiscale non valido (codice di controllo errato)' })
    .optional(),
  address: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  zipCode: z.string().length(5).optional(),
  province: z.string().length(2).optional(),
  country: z.string().optional(),
  taxRegime: z.enum(['FORFETTARIO', 'ORDINARIO']).optional(),
  password: z.string().min(8).optional(),
});

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  return session.user.id;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const session = await getServerSession(authOptions);
    
    if (session?.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accesso negato: solo amministratori' }, { status: 403 });
    }

    const { id } = await params;
    
    const user = await prisma.user.findUnique({
      where: { id },
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
    });

    if (!user) {
      return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof Error && error.message === 'Non autenticato') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Error fetching user:', error);
    return NextResponse.json({ error: 'Errore nel recupero utente' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const session = await getServerSession(authOptions);
    
    if (session?.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accesso negato: solo amministratori' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const data = userUpdateSchema.parse(body);

    if (data.email) {
      const existingUser = await prisma.user.findFirst({
        where: { email: data.email, NOT: { id } },
      });
      if (existingUser) {
        return NextResponse.json({ error: 'Email già in uso' }, { status: 400 });
      }
    }

    const updateData: any = { ...data };
    if (data.password) {
      updateData.passwordHash = await hashPassword(data.password);
      delete updateData.password;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
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

    return NextResponse.json(user);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues.map((issue) => issue.message).join('; ') },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === 'Non autenticato') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Errore nell\'aggiornamento utente' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const session = await getServerSession(authOptions);
    
    if (session?.user?.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accesso negato: solo amministratori' }, { status: 403 });
    }

    const { id } = await params;
    
    if (id === userId) {
      return NextResponse.json({ error: 'Non puoi eliminare te stesso' }, { status: 400 });
    }

    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Non autenticato') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Errore nell\'eliminazione utente' }, { status: 500 });
  }
}