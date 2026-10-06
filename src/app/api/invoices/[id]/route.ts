import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { calculateInvoiceTotals } from '@/lib/tax';
import { generateFatturaPAXml, userToSdiConfig } from '@/lib/xml-generator';
import { generateInvoicePdfBuffer, userToSenderInfo } from '@/lib/pdf-generator';
import { authOptions } from '@/lib/auth';

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
      businessName: true,
      vatNumber: true,
      taxCode: true,
      address: true,
      city: true,
      zipCode: true,
      country: true,
      province: true,
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

    const invoice = await verifyInvoiceOwnership(userId, id);
    const user = await getUserWithTaxRegime(userId);

    const totals = calculateInvoiceTotals({
      subtotal: Number(invoice.subtotalAmount),
      clientType: invoice.client.type,
      taxRegime: user.taxRegime,
    });

    const sdiConfig = userToSdiConfig(user as any);
    const senderInfo = userToSenderInfo(user as any);

    if (format === 'xml') {
      const xml = generateFatturaPAXml({
        invoice,
        totals,
        config: sdiConfig,
      });

      return new NextResponse(xml, {
        headers: {
          'Content-Type': 'application/xml',
          'Content-Disposition': `attachment; filename="fattura_${invoice.number}_${invoice.year}.xml"`,
        },
      });
    }

    if (format === 'pdf') {
      const buffer = await generateInvoicePdfBuffer({
        invoice,
        totals,
        sender: senderInfo,
      });

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="fattura_${invoice.number}_${invoice.year}.pdf"`,
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    
    await verifyInvoiceOwnership(userId, id);
    
    await prisma.invoice.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && (error.message === 'Non autenticato' || error.message.includes('accesso negato'))) {
      return NextResponse.json({ error: error.message }, { status: error.message === 'Non autenticato' ? 401 : 403 });
    }
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ error: 'Errore nell\'eliminazione fattura' }, { status: 500 });
  }
}