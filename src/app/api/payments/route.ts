import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { getUserDek, decryptPayment, decryptClient, decryptInvoice, encryptPaymentInput } from '@/lib/data-encryption';
import { recalculateInvoiceStatus } from '@/lib/invoice-status';

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
  description: z.string().optional(),
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
    const dek = await getUserDek(userId);
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
      // paidAt è cifrato: ordinamento su createdAt (plaintext).
      orderBy: { createdAt: 'desc' },
    });
    const decrypted = await Promise.all(payments.map(async (p) => {
      const payment = await decryptPayment(p, dek);
      payment.client = await decryptClient(p.client, dek);
      payment.invoice = p.invoice ? await decryptInvoice(p.invoice, dek) : null;
      return payment;
    }));
    return NextResponse.json(decrypted);
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
    const dek = await getUserDek(userId);
    const body = await request.json();
    const data = paymentSchema.parse(body);

    await verifyClientOwnership(userId, data.clientId);

    if (data.invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: data.invoiceId, userId },
      });
      if (!invoice) {
        throw new Error('Fattura non trovata o accesso negato');
      }
      if (invoice.clientId !== data.clientId) {
        return NextResponse.json(
          { error: "L'incasso deve appartenere allo stesso cliente della fattura" },
          { status: 400 }
        );
      }
    }

    const originalCurrency = (data.originalCurrency || '').trim().toUpperCase() || undefined;
    // Descrizione facoltativa: se vuota, "Accredito" (mai precompilata nel campo HTML).
    const description = (data.description || '').trim() || 'Accredito';

    const encrypted = encryptPaymentInput({
      ...data,
      description,
      paidAt: new Date(data.paidAt),
      originalCurrency: data.originalAmount !== undefined && originalCurrency ? originalCurrency : undefined,
    }, dek);

    const payment = await prisma.payment.create({
      data: {
        ...encrypted,
        userId,
        clientId: data.clientId,
        invoiceId: data.invoiceId,
      },
      include: { client: true },
    });

    // Se l'incasso è collegato a un documento, rivaluta lo stato del documento
    // (copertura totale -> Saldata, altrimenti Parzialmente saldata).
    if (data.invoiceId) {
      await recalculateInvoiceStatus(userId, data.invoiceId, dek);
    }

    const decrypted = await decryptPayment(payment, dek);
    decrypted.client = await decryptClient(payment.client, dek);
    return NextResponse.json(decrypted, { status: 201 });
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