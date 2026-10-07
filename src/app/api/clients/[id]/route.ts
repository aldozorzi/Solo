import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const clientUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['ITALY', 'EU', 'EXTRA_EU']).optional(),
  vatNumber: z.string().optional(),
  taxCode: z.string().optional(),
  sdiCode: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().optional(),
});

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  return session.user.id;
}

async function verifyClientOwnership(userId: string, clientId: string) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, userId },
  });
  if (!client) {
    throw new Error('Cliente non trovato o accesso negato');
  }
  return client;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    
    await verifyClientOwnership(userId, id);
    
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { paidAt: 'desc' } },
        invoices: { orderBy: { date: 'desc' } },
      },
    });
    return NextResponse.json(client);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error fetching client:', error);
    return NextResponse.json({ error: 'Errore nel recupero cliente' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    
    await verifyClientOwnership(userId, id);
    
    const body = await request.json();
    const data = clientUpdateSchema.parse(body);

    const client = await prisma.client.update({
      where: { id },
      data,
    });
    return NextResponse.json(client);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error updating client:', error);
    return NextResponse.json({ error: 'Errore nell\'aggiornamento cliente' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    
    await verifyClientOwnership(userId, id);
    
    await prisma.client.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json(
        { error: 'Impossibile eliminare il cliente: esistono pagamenti o fatture collegati' },
        { status: 409 }
      );
    }
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error deleting client:', error);
    return NextResponse.json({ error: 'Errore nell\'eliminazione cliente' }, { status: 500 });
  }
}