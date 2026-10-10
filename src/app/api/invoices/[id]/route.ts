import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { calculateInvoiceTotals, deriveInvoiceStatus } from '@/lib/tax';
import { generateFatturaPAXml, userToSdiConfig, generateFileName, invoiceProgressivo } from '@/lib/xml-generator';
import { generateInvoicePdfBuffer, generateRicevutaPdfBuffer, userToSenderInfo } from '@/lib/pdf-generator';
import { authOptions } from '@/lib/auth';
import { auditEvent } from '@/lib/audit';
import { getUserDek, decryptInvoice, decryptClient, decryptPayment, decryptInvoiceItem, encryptInvoiceItemInput } from '@/lib/data-encryption';
import { encryptField } from '@/lib/crypto';

const dateInputSchema = z.string().min(1, 'Data obbligatoria').refine(
  (v) => !Number.isNaN(Date.parse(v)),
  { message: 'Data non valida' }
);

const invoiceItemSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
});

const invoiceUpdateSchema = z.object({
  date: dateInputSchema.optional(),
  clientId: z.string().min(1).optional(),
  paymentIds: z.array(z.string()).min(1).optional(),
  items: z.array(invoiceItemSchema).min(1).optional(),
  status: z.enum(['ISSUED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED']).optional(),
});

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  return session.user.id;
}

async function verifyInvoiceOwnership(userId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId },
    include: {
      client: true,
      items: true,
      payments: true,
    },
  });
  if (!invoice) {
    throw new Error('Fattura non trovata o accesso negato');
  }
  return invoice;
}

async function getUserWithTaxRegime(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { 
      taxRegime: true,
      senderType: true,
      businessName: true,
      vatNumber: true,
      taxCode: true,
      address: true,
      city: true,
      zipCode: true,
      country: true,
      province: true,
      email: true,
    },
  });
  if (!user) {
    throw new Error('Utente non trovato');
  }
  return user;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'json';

    const dek = await getUserDek(userId);
    const stored = await verifyInvoiceOwnership(userId, id);
    const user = await getUserWithTaxRegime(userId);

    // Decifra fattura + relazioni per l'uso in chiaro (totali, XML, PDF).
    const invoice = await decryptInvoice(stored, dek);
    invoice.client = await decryptClient(stored.client, dek);
    invoice.items = await Promise.all(stored.items.map((i) => decryptInvoiceItem(i, dek)));
    invoice.payments = await Promise.all(stored.payments.map((p) => decryptPayment(p, dek)));

    // I generatori accettano direttamente le forme decifrate (stessi nomi di campo).
    const invoiceForExport = {
      ...invoice,
      client: invoice.client!,
      items: invoice.items ?? [],
      payments: invoice.payments ?? [],
    };

    const totals = calculateInvoiceTotals({
      subtotal: Number(invoice.subtotalAmount),
      clientType: invoice.client.type,
      taxRegime: user.taxRegime,
      senderType: user.senderType,
      clientVatNumber: invoice.client.vatNumber,
    });

    // Le ricevute per prestazione occasionale non transitano mai da SdI:
    // niente XML, niente transizione di stato legata all'esportazione.
    const isRicevuta = user.taxRegime === 'PRESTAZIONE_OCCASIONALE';

    const sdiConfig = userToSdiConfig(user);
    sdiConfig.progressivoInvio = invoiceProgressivo(invoiceForExport);
    const senderInfo = userToSenderInfo(user);

    if (format === 'xml') {
      if (isRicevuta) {
        return NextResponse.json(
          { error: 'Le ricevute per prestazione occasionale non prevedono invio telematico SdI' },
          { status: 403 }
        );
      }
      // L'esportazione non cambia mai lo stato: è derivato dagli incassi
      // in creazione/modifica.

      const xml = generateFatturaPAXml({
        invoice: invoiceForExport,
        totals,
        config: sdiConfig,
      });

      const fileName = generateFileName(invoiceForExport, sdiConfig);

      auditEvent({ type: 'invoice.exported', actor: userId, target: id, details: { format: 'xml' } });

      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/xml',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    }

    if (format === 'pdf') {
      // Il totale esposto riflette sempre la somma live in EUR degli accrediti collegati.
      const liveSubtotal =
        invoice.payments.length > 0
          ? invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0)
          : totals.subtotal;
      const liveVat =
        totals.vatRate > 0 ? Math.round(liveSubtotal * (totals.vatRate / 100) * 100) / 100 : 0;
      const pdfTotals = {
        ...totals,
        subtotal: Math.round(liveSubtotal * 100) / 100,
        vatAmount: liveVat,
        totalAmount: Math.round((liveSubtotal + liveVat) * 100) / 100,
      };
      const buffer = isRicevuta
        ? await generateRicevutaPdfBuffer({
            invoice: invoiceForExport,
            totals: pdfTotals,
            sender: senderInfo,
          })
        : await generateInvoicePdfBuffer({
            invoice: invoiceForExport,
            totals: pdfTotals,
            sender: senderInfo,
          });

      auditEvent({ type: 'invoice.exported', actor: userId, target: id, details: { format: 'pdf' } });

      const pdfFileName = isRicevuta
        ? `ricevuta_${invoice.number}_${invoice.year}.pdf`
        : `fattura_${invoice.number}_${invoice.year}.pdf`;

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${pdfFileName}"`,
        },
      });
    }

    return NextResponse.json({ invoice, totals });
  } catch (error) {
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato') || error.message === 'Utente non trovato')) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error fetching invoice:', error);
    return NextResponse.json({ error: 'Errore nel recupero fattura' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    const dek = await getUserDek(userId);
    const existing = await verifyInvoiceOwnership(userId, id);

    const body = await request.json();
    const data = invoiceUpdateSchema.parse(body);

    const effectiveClientId = data.clientId ?? existing.clientId;
    const client = await prisma.client.findFirst({
      where: { id: effectiveClientId, userId },
    });
    if (!client) {
      return NextResponse.json({ error: 'Cliente non trovato o accesso negato' }, { status: 403 });
    }

    if (data.clientId && data.clientId !== existing.clientId && !data.paymentIds) {
      return NextResponse.json(
        { error: 'Cambiando cliente è necessario riselezionare gli incassi' },
        { status: 400 }
      );
    }

    let paymentConnect: { id: string }[] | undefined;
    let storedPayments = existing.payments;
    if (data.paymentIds) {
      const payments = await prisma.payment.findMany({
        where: { id: { in: data.paymentIds }, userId },
      });
      storedPayments = payments;
      if (payments.length !== data.paymentIds.length) {
        return NextResponse.json({ error: 'Alcuni pagamenti non trovati o accesso negato' }, { status: 403 });
      }
      if (!payments.every((p) => p.clientId === effectiveClientId)) {
        return NextResponse.json(
          { error: 'Tutti gli incassi devono appartenere allo stesso cliente della fattura' },
          { status: 400 }
        );
      }
      if (payments.some((p) => p.invoiceId && p.invoiceId !== id)) {
        return NextResponse.json(
          { error: "Alcuni incassi sono già collegati a un'altra fattura" },
          { status: 400 }
        );
      }
      paymentConnect = data.paymentIds.map((pid) => ({ id: pid }));
    }

    const user = await getUserWithTaxRegime(userId);

    const existingItems = await Promise.all(
      existing.items.map(async (it) => {
        const dec = await decryptInvoiceItem(it, dek);
        return { description: dec.description, amount: dec.amount };
      })
    );
    const effectiveItems = data.items ?? existingItems;
    const subtotal = effectiveItems.reduce((sum, item) => sum + item.amount, 0);
    const decClient = await decryptClient(client, dek);
    const totals = calculateInvoiceTotals({
      subtotal,
      clientType: client.type,
      taxRegime: user.taxRegime,
      senderType: user.senderType,
      clientVatNumber: decClient.vatNumber,
    });

    const encDate = data.date !== undefined
      ? encryptField(new Date(data.date).toISOString(), dek) : null;
    const encSubtotal = encryptField(String(totals.subtotal), dek);
    const encStamp = encryptField(String(totals.stampDutyAmount), dek);
    const encTotal = encryptField(String(totals.totalAmount), dek);
    const encNotes = totals.legalNotes ? encryptField(totals.legalNotes, dek) : null;

    // Lo stato segue gli incassi: se cambiano righe o collegamenti (e non è
    // impostato esplicitamente né annullata), viene ricalcolato come in creazione.
    let derivedStatus: 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | undefined;
    if (
      data.status === undefined &&
      existing.status !== 'CANCELLED' &&
      (data.items !== undefined || data.paymentIds !== undefined)
    ) {
      const decEffective = await Promise.all(
        storedPayments.map((p) => decryptPayment(p, dek))
      );
      derivedStatus = deriveInvoiceStatus({
        paymentsSum: decEffective.reduce((sum, p) => sum + Number(p.amount), 0),
        dueAmount: totals.subtotal + (totals.vatAmount || 0),
        hasPayments: decEffective.length > 0,
      });
    }

    const stored = await prisma.invoice.update({
      where: { id },
      data: {
        ...(encDate ? { dateEnc: encDate.ciphertext, dateIv: encDate.iv } : {}),
        clientId: effectiveClientId,
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(derivedStatus !== undefined ? { status: derivedStatus } : {}),
        subtotalAmountEnc: encSubtotal.ciphertext,
        subtotalAmountIv: encSubtotal.iv,
        stampDutyAmountEnc: encStamp.ciphertext,
        stampDutyAmountIv: encStamp.iv,
        totalAmountEnc: encTotal.ciphertext,
        totalAmountIv: encTotal.iv,
        notesEnc: encNotes?.ciphertext ?? null,
        notesIv: encNotes?.iv ?? null,
        ...(data.items !== undefined
          ? {
              items: {
                deleteMany: {},
                create: data.items.map((item) => encryptInvoiceItemInput(item, dek)),
              },
            }
          : {}),
        ...(paymentConnect !== undefined ? { payments: { set: paymentConnect } } : {}),
      },
      include: {
        client: true,
        items: true,
        payments: true,
      },
    });

    const invoice = await decryptInvoice(stored, dek);
    invoice.client = await decryptClient(stored.client, dek);
    invoice.items = await Promise.all(stored.items.map((i) => decryptInvoiceItem(i, dek)));
    invoice.payments = await Promise.all(stored.payments.map((p) => decryptPayment(p, dek)));

    return NextResponse.json(invoice);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error updating invoice:', error);
    return NextResponse.json({ error: "Errore nell'aggiornamento fattura" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    
    await verifyInvoiceOwnership(userId, id);

    await prisma.invoice.delete({ where: { id } });
    auditEvent({ type: 'invoice.deleted', actor: userId, target: id });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json(
        { error: 'Impossibile eliminare la fattura: esistono dati collegati' },
        { status: 409 }
      );
    }
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ error: 'Errore nell\'eliminazione fattura' }, { status: 500 });
  }
}