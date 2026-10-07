import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const paymentUpdateSchema = z.object({
  clientId: z.string().min(1, 'Cliente obbligatorio').optional(),
  amount: z.number().positive('Importo deve essere positivo').optional(),
  currency: z.string().optional(),
  originalAmount: z.number().positive('Importo deve essere positivo').optional().nullable(),
  originalCurrency: z.string().min(1).max(3).optional().nullable(),
  paidAt: z
    .string()
    .min(1, 'Data obbligatoria')
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Data non valida' })
    .optional(),
  description: z.string().min(1, 'Descrizione obbligatoria').optional(),
});

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  return session.user.id;
}

async function getPendingPayment(userId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, userId },
  });
  if (!payment) {
    throw new Error('Incasso non trovato o accesso negato');
  }
  if (payment.invoiceId) {
    throw new Error('Incasso già fatturato: non modificabile né eliminabile');
  }
  return payment;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    await getPendingPayment(userId, id);

    const body = await request.json();
    const data = paymentUpdateSchema.parse(body);

    if (data.clientId) {
      const client = await prisma.client.findFirst({
        where: { id: data.clientId, userId },
      });
      if (!client) {
        throw new Error('Cliente non trovato o accesso negato');
      }
    }

    const originalCurrency = ((data.originalCurrency as string | null | undefined) || '')
      .trim()
      .toUpperCase() || null;

    const payment = await prisma.payment.update({
      where: { id },
      data: {
        ...(data.clientId !== undefined ? { clientId: data.clientId } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.originalAmount !== undefined ? { originalAmount: data.originalAmount } : {}),
        ...(data.originalCurrency !== undefined || data.originalAmount === null
          ? {
              originalCurrency:
                data.originalAmount !== undefined &&
                data.originalAmount !== null &&
                originalCurrency
                  ? originalCurrency
                  : null,
            }
          : {}),
        ...(data.paidAt !== undefined ? { paidAt: new Date(data.paidAt) } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
      },
      include: { client: true },
    });

    return NextResponse.json(payment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error) {
      if (error.message === 'Non autenticato') {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      if (error.message.includes('accesso negato') || error.message.includes('non trovato')) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.message.includes('già fatturato')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }
    console.error('Error updating payment:', error);
    return NextResponse.json({ error: "Errore nell'aggiornamento incasso" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    await getPendingPayment(userId, id);

    await prisma.payment.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Non autenticato') {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      if (error.message.includes('accesso negato') || error.message.includes('non trovato')) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.message.includes('già fatturato')) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }
    console.error('Error deleting payment:', error);
    return NextResponse.json({ error: "Errore nell'eliminazione incasso" }, { status: 500 });
  }
}
