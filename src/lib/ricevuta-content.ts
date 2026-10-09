import {
  formatCurrency,
  formatDate,
  formatDualAmount,
  type ClientType,
  type InvoiceTotals,
} from './tax';
import type {
  DecryptedClient,
  DecryptedInvoiceItem,
  DecryptedPayment,
} from './data-encryption';

/** Sottoinsieme dei dati emittente necessario alla ricevuta. */
export interface RicevutaSender {
  name: string;
  taxCode: string;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  province: string | null;
}

export interface RicevutaInvoice {
  number: number;
  year: number;
  date: Date;
  client: DecryptedClient;
  items: DecryptedInvoiceItem[];
  payments: DecryptedPayment[];
}

export interface RicevutaProps {
  invoice: RicevutaInvoice;
  totals: InvoiceTotals;
  sender: RicevutaSender;
}

/**
 * Contenuto testuale della ricevuta, blocco per blocco, nell'ordine di stampa.
 * Ricalca in tutto e per tutto la ricevuta di riferimento (SPECS/ricevuta.pdf):
 * intestazione RICEVUTA, emittente senza P.IVA, cliente senza codici fiscali,
 * accrediti dinamici con doppi importi, TOTALE LORDO e note legali di regime.
 */
export interface RicevutaContent {
  header: string[];
  emitter: string[];
  client: string[];
  oggetto: string[];
  payments: string[];
  totals: string[];
  notes: string[];
  signature: string[];
}

export function formatSenderAddress(sender: RicevutaSender): string {
  const parts: string[] = [];
  if (sender.address) parts.push(sender.address);
  const cityPart = [sender.zipCode, sender.city].filter(Boolean).join(', ');
  if (cityPart) parts.push(sender.province ? `${cityPart} (${sender.province})` : cityPart);
  return parts.join(', ') || 'N/A';
}

export function formatClientAddress(client: DecryptedClient): string {
  const parts: string[] = [];
  if (client.address) parts.push(client.address);
  const locality = [client.zipCode, client.city].filter(Boolean).join(' ');
  if (locality) parts.push(locality);
  if (client.country) parts.push(client.country);
  return parts.join(', ') || 'N/A';
}

export function formatPaymentLine(
  payment: DecryptedPayment,
  clientType: ClientType
): string {
  const date = formatDate(payment.paidAt);
  const amounts = formatDualAmount(
    payment.amount,
    payment.originalAmount,
    payment.originalCurrency,
    clientType
  );
  return `- Accredito del ${date}: ${amounts}`;
}

function sortPayments(payments: DecryptedPayment[]): DecryptedPayment[] {
  return [...payments].sort(
    (a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
  );
}

function joinOggetto(
  items: DecryptedInvoiceItem[],
  payments: DecryptedPayment[]
): string {
  return items.length > 0
    ? items.map((item) => item.description).join('; ')
    : payments.map((payment) => payment.description).join('; ');
}

export function buildRicevutaContent({ invoice, totals, sender }: RicevutaProps): RicevutaContent {
  const { client, items, payments } = invoice;
  const sortedPayments = sortPayments(payments);

  const totalsLines = [`TOTALE LORDO: ${formatCurrency(totals.subtotal)}`];
  const netto =
    totals.hasWithholding && totals.withholdingAmount > 0
      ? Math.round((totals.subtotal - totals.withholdingAmount) * 100) / 100
      : null;
  if (netto !== null) {
    totalsLines.push(`Ritenuta d'acconto (20%): ${formatCurrency(totals.withholdingAmount)}`);
    totalsLines.push(`NETTO A PAGARE: ${formatCurrency(netto)}`);
  }

  const paymentLines =
    sortedPayments.length > 0
      ? sortedPayments.map((payment) => formatPaymentLine(payment, client.type))
      : items.map((item) => `- ${item.description}: ${formatCurrency(item.amount)}`);

  const oggettoLines =
    items.length <= 1
      ? [`OGGETTO: ${joinOggetto(items, payments)}`]
      : ['OGGETTO:', ...items.map((item) => item.description)];

  return {
    header: [`RICEVUTA N. ${invoice.number}/${invoice.year}`, `Data: ${formatDate(invoice.date)}`],
    emitter: ['EMESSA DA:', sender.name, sender.taxCode, formatSenderAddress(sender)],
    client: ['NEI CONFRONTI DI:', client.name, formatClientAddress(client)],
    oggetto: oggettoLines,
    payments: paymentLines,
    totals: totalsLines,
    notes: [totals.legalNotes],
    signature: [sender.name],
  };
}

/** Appiattisce il contenuto in righe, nell'ordine di stampa. */
export function flattenRicevutaContent(content: RicevutaContent): string[] {
  return [
    ...content.header,
    ...content.emitter,
    ...content.client,
    ...content.oggetto,
    ...content.payments,
    ...content.totals,
    ...content.notes,
    ...content.signature,
  ];
}
