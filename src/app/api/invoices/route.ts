import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { calculateInvoiceTotals } from '@/lib/tax';
import { authOptions } from '@/lib/auth';
import { auditEvent } from '@/lib/audit';
import { getUserDek, decryptInvoice, decryptClient, decryptPayment, decryptInvoiceItem, encryptInvoiceInput, encryptInvoiceItemInput } from '@/lib/data-encryption';

const invoiceItemSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
});

const dateInputSchema = z.string().min(1, 'Data obbligatoria').refine(
  (v) => !Number.isNaN(Date.parse(v)),
  { message: 'Data non valida' }
);

const invoiceSchema = z.object({
  clientId: z.string().min(1, 'Cliente obbligatorio'),
  date: dateInputSchema,
  paymentIds: z.array(z.string()).default([]),
  items: z.array(invoiceItemSchema).min(1, 'Almeno una riga fattura richiesta'),
  notes: z.string().optional(),
});

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  return session.user.id;
}

async function getUserWithTaxRegime(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { taxRegime: true, senderType: true },
  });
  if (!user) {
    throw new Error('Utente non trovato');
  }
  return user;
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

async function verifyPaymentsOwnership(userId: string, paymentIds: string[]) {
  const payments = await prisma.payment.findMany({
    where: { id: { in: paymentIds }, userId },
  });
  if (payments.length !== paymentIds.length) {
    throw new Error('Alcuni pagamenti non trovati o accesso negato');
  }
  return payments;
}

export async function GET(request: NextRequest) {
  try {
    const userId = await getUserId();
    const dek = await getUserDek(userId);
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    const where: Record<string, unknown> = { userId };
    if (clientId) {
      await verifyClientOwnership(userId, clientId);
      where.clientId = clientId;
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        client: true,
        items: true,
        payments: true,
      },
      orderBy: [{ year: 'desc' }, { number: 'desc' }],
    });
    const decrypted = await Promise.all(invoices.map(async (inv) => {
      const invoice = await decryptInvoice(inv, dek);
      invoice.client = await decryptClient(inv.client, dek);
      invoice.items = await Promise.all(inv.items.map(i => decryptInvoiceItem(i, dek)));
      invoice.payments = await Promise.all(inv.payments.map(p => decryptPayment(p, dek)));
      return invoice;
    }));
    return NextResponse.json(decrypted);
  } catch (error) {
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ error: 'Errore nel recupero fatture' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId();
    const dek = await getUserDek(userId);
    const body = await request.json();
    const data = invoiceSchema.parse(body);

    const client = await verifyClientOwnership(userId, data.clientId);
    const payments = await verifyPaymentsOwnership(userId, data.paymentIds);

    if (!payments.every((p) => p.clientId === data.clientId)) {
      return NextResponse.json(
        { error: 'Tutti gli incassi devono appartenere allo stesso cliente della fattura' },
        { status: 400 }
      );
    }
    if (payments.some((p) => p.invoiceId)) {
      return NextResponse.json(
        { error: "Alcuni incassi sono già collegati a un'altra fattura" },
        { status: 400 }
      );
    }

    const user = await getUserWithTaxRegime(userId);

    const subtotal = data.items.reduce((sum, item) => sum + item.amount, 0);
    const decClient = await decryptClient(client, dek);
    const totals = calculateInvoiceTotals({
      subtotal,
      clientType: client.type,
      taxRegime: user.taxRegime,
      senderType: user.senderType,
      clientVatNumber: decClient.vatNumber,
    });

    const lastInvoice = await prisma.invoice.findFirst({
      where: { userId, year: new Date(data.date).getFullYear() },
      orderBy: { number: 'desc' },
    });

    const nextNumber = (lastInvoice?.number || 0) + 1;
    const year = new Date(data.date).getFullYear();

    const encryptedInvoice = encryptInvoiceInput({
      number: nextNumber,
      year,
      date: new Date(data.date),
      clientId: data.clientId,
      subtotalAmount: totals.subtotal,
      stampDutyAmount: totals.stampDutyAmount,
      totalAmount: totals.totalAmount,
      notes: totals.legalNotes,
      status: 'DRAFT',
    }, dek);

    const encryptedItems = data.items.map(item => encryptInvoiceItemInput(item, dek));

    const invoice = await prisma.invoice.create({
      data: {
        ...encryptedInvoice,
        userId,
        items: {
          create: encryptedItems,
        },
        payments: {
          connect: data.paymentIds.map(id => ({ id })),
        },
      },
      include: {
        client: true,
        items: true,
        payments: true,
      },
    });

    auditEvent({
      type: 'invoice.created',
      actor: userId,
      target: invoice.id,
      details: { number: invoice.number, year: invoice.year, clientId: data.clientId },
    });

    const decrypted = await decryptInvoice(invoice, dek);
    decrypted.client = await decryptClient(invoice.client, dek);
    decrypted.items = await Promise.all(invoice.items.map(i => decryptInvoiceItem(i, dek)));
    decrypted.payments = await Promise.all(invoice.payments.map(p => decryptPayment(p, dek)));
    return NextResponse.json(decrypted, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato') || error.message === 'Utente non trovato')) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error creating invoice:', error);
    return NextResponse.json({ error: 'Errore nella creazione fattura' }, { status: 500 });
  }
}