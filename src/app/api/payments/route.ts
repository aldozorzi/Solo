import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const dateInputSchema = z.string().min(1, 'Data obbligatoria').refine(
  (v) => !Number.isNaN(Date.parse(v)),
  { message: 'Data non valida' }
);

const paymentSchema = z.object({
  clientId: z.string().min(1, 'Cliente obbligatorio'),
  amount: z.number().positive('Importo deve essere positivo'),
  currency: z.string().default('EUR'),
  originalAmount: z.number().positive('Importo deve essere positivo').optional(),
  originalCurrency: z.string().min(1).max(3).optional(),
  paidAt: dateInputSchema,
  description: z.string().min(1, 'Descrizione obbligatoria'),
  invoiceId: z.string().optional(),
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

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');
    const withoutInvoice = searchParams.get('withoutInvoice') === 'true';

    const where: Record<string, unknown> = { userId };
    if (clientId) {
      await verifyClientOwnership(userId, clientId);
      where.clientId = clientId;
    }
    if (withoutInvoice) where.invoiceId = null;

    const payments = await prisma.payment.findMany({
      where,
      include: {
        client: true,
        invoice: true,
      },
      orderBy: { paidAt: 'desc' },
    });
    return NextResponse.json(payments);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error fetching payments:', error);
    return NextResponse.json({ error: 'Errore nel recupero pagamenti' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const data = paymentSchema.parse(body);

    await verifyClientOwnership(userId, data.clientId);

    const originalCurrency = (data.originalCurrency || '').trim().toUpperCase() || undefined;

    const payment = await prisma.payment.create({
      data: {
        ...data,
        originalCurrency:
          data.originalAmount !== undefined && originalCurrency ? originalCurrency : undefined,
        userId,
        paidAt: new Date(data.paidAt),
      },
      include: { client: true },
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error creating payment:', error);
    return NextResponse.json({ error: 'Errore nella creazione pagamento' }, { status: 500 });
  }
}