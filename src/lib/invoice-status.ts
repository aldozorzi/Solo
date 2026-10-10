import { prisma } from '@/lib/prisma';
import { deriveInvoiceStatus } from '@/lib/tax';
import { decryptInvoice, decryptPayment } from '@/lib/data-encryption';

/**
 * Ricalcola lo stato di un documento dagli incassi collegati:
 * copertura totale -> PAID ("Saldata"), parziale -> PARTIALLY_PAID,
 * nessun incasso -> ISSUED ("Da saldare").
 *
 * Da chiamare dopo ogni operazione che tocca i collegamenti (creazione con
 * invoiceId, modifica o eliminazione di un incasso collegato).
 * Le fatture annullate non si toccano mai.
 * Ritorna lo status applicato, o null se il documento non esiste (o non è tuo).
 */
export async function recalculateInvoiceStatus(
  userId: string,
  invoiceId: string,
  dek: Buffer
): Promise<string | null> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId },
    include: { payments: true },
  });
  if (!invoice) return null;
  if (invoice.status === 'CANCELLED') return invoice.status;

  const decInvoice = await decryptInvoice(invoice, dek);
  const decPayments = await Promise.all(invoice.payments.map((p) => decryptPayment(p, dek)));
  const next = deriveInvoiceStatus({
    paymentsSum: decPayments.reduce((sum, p) => sum + Number(p.amount), 0),
    dueAmount: Number(decInvoice.totalAmount),
    hasPayments: decPayments.length > 0,
  });
  if (next !== invoice.status) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: next } });
    return next;
  }
  return invoice.status;
}
