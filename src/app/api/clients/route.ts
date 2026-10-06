import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const clientSchema = z.object({
  name: z.string().min(1, 'Nome obbligatorio'),
  type: z.enum(['ITALY', 'EU', 'EXTRA_EU']),
  vatNumber: z.string().optional(),
  taxCode: z.string().optional(),
  sdiCode: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().default('US'),
});

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  return session.user.id;
}

export async function GET() {
  try {
    const userId = await getUserId();
    const clients = await prisma.client.findMany({
      where: { userId },
      include: {
        _count: {
          select: { payments: true, invoices: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json({ error: 'Errore nel recupero clienti' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const data = clientSchema.parse(body);

    const defaults = {
      ITALY: { sdiCode: '0000000', zipCode: data.zipCode || '' },
      EU: { sdiCode: 'XXXXXXX', zipCode: '00000' },
      EXTRA_EU: { sdiCode: 'XXXXXXX', zipCode: '00000' },
    }[data.type];

    const client = await prisma.client.create({
      data: {
        ...data,
        userId,
        sdiCode: data.sdiCode || defaults.sdiCode,
        zipCode: data.zipCode || defaults.zipCode,
        country: data.country || (data.type === 'ITALY' ? 'IT' : 'US'),
      },
    });

    return NextResponse.json(client, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'Non autenticato') {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
    }
    console.error('Error creating client:', error);
    return NextResponse.json({ error: 'Errore nella creazione cliente' }, { status: 500 });
  }
}