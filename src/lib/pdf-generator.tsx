import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { Invoice, Client, InvoiceItem, Payment, User, TaxRegime } from '@prisma/client';
import { InvoiceTotals, formatCurrency, formatDate, formatDualAmount } from './tax';

Font.register({
  family: 'Ubuntu Mono',
  fonts: [
    {
      src: 'https://fonts.gstatic.com/s/ubuntumono/v19/KFOjCneDtsqEr0keqCMhbBc9.ttf',
    },
    {
      src: 'https://fonts.gstatic.com/s/ubuntumono/v19/KFO-CneDtsqEr0keqCMhbC-BL-Hy.ttf',
      fontWeight: 'bold',
    },
  ],
});

interface SenderInfo {
  name: string;
  vatNumber: string;
  taxCode: string;
  address: string;
  city: string;
  zipCode: string;
  province: string;
  country: string;
  taxRegime: TaxRegime;
  email?: string;
  phone?: string;
}

export function userToSenderInfo(user: User): SenderInfo {
  return {
    name: user.businessName,
    vatNumber: user.vatNumber,
    taxCode: user.taxCode,
    address: user.address,
    city: user.city,
    zipCode: user.zipCode,
    province: user.province || 'RM',
    country: user.country || 'IT',
    taxRegime: user.taxRegime,
    email: undefined,
    phone: undefined,
  };
}

interface InvoicePdfProps {
  invoice: Invoice & {
    client: Client;
    items: InvoiceItem[];
    payments: Payment[];
  };
  totals: InvoiceTotals;
  sender: SenderInfo;
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Ubuntu Mono',
    lineHeight: 1.5,
  },
  block: {
    marginBottom: 10,
  },
});

function formatSenderAddress(sender: SenderInfo): string {
  const parts: string[] = [];
  if (sender.address) parts.push(sender.address);
  const cityPart = [sender.zipCode, sender.city].filter(Boolean).join(', ');
  if (cityPart) parts.push(sender.province ? `${cityPart} (${sender.province})` : cityPart);
  return parts.join(', ') || 'N/A';
}

function formatClientAddress(client: Client): string {
  const parts: string[] = [];
  if (client.address) parts.push(client.address);
  const locality = [client.zipCode, client.city].filter(Boolean).join(' ');
  if (locality) parts.push(locality);
  if (client.country) parts.push(client.country);
  return parts.join(', ') || 'N/A';
}

function formatPaymentLine(
  payment: Payment,
  clientType: Client['type']
): string {
  const date = formatDate(payment.paidAt);
  const amounts = formatDualAmount(
    payment.amount,
    (payment as any).originalAmount,
    (payment as any).originalCurrency,
    clientType
  );
  return `- Accredito del ${date}: ${amounts}`;
}

export function InvoicePdfDocument(props: InvoicePdfProps) {
  const { invoice, totals, sender } = props;
  const { client, items, payments } = invoice;

  // Il bollo virtuale non è esplicitato negli importi: compare solo nelle diciture.
  const pdfTotal = totals.subtotal + (totals.vatAmount || 0);

  const sortedPayments = [...payments].sort(
    (a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()
  );

  const oggetto =
    items.length > 0
      ? items.map((item) => item.description).join('; ')
      : payments.map((payment) => payment.description).join('; ');

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.block}>
          <Text>
            FATTURA N. {invoice.number}/{invoice.year}
          </Text>
          <Text>Data: {formatDate(invoice.date)}</Text>
        </View>

        <View style={styles.block}>
          <Text>EMESSA DA:</Text>
          <Text>{sender.name}</Text>
          <Text>P.IVA: {sender.vatNumber}</Text>
          <Text>C.F.: {sender.taxCode}</Text>
          <Text>{formatSenderAddress(sender)}</Text>
        </View>

        <View style={styles.block}>
          <Text>NEI CONFRONTI DI:</Text>
          <Text>{client.name}</Text>
          {client.vatNumber && <Text>P.IVA / Tax ID: {client.vatNumber}</Text>}
          {client.taxCode && <Text>C.F.: {client.taxCode}</Text>}
          <Text>{formatClientAddress(client)}</Text>
        </View>

        <View style={styles.block}>
          {items.length <= 1 ? (
            <Text>OGGETTO: {oggetto}</Text>
          ) : (
            <>
              <Text>OGGETTO:</Text>
              {items.map((item) => (
                <Text key={item.id}>{item.description}</Text>
              ))}
            </>
          )}
        </View>

        <View style={styles.block}>
          {sortedPayments.length > 0 ? (
            sortedPayments.map((payment) => (
              <Text key={payment.id}>
                {formatPaymentLine(payment, client.type)}
              </Text>
            ))
          ) : (
            items.map((item) => (
              <Text key={item.id}>
                - {item.description}: {formatCurrency(item.amount)}
              </Text>
            ))
          )}
        </View>

        <View style={styles.block}>
          {totals.vatAmount > 0 && (
            <Text>
              IVA ({totals.vatRate}%): {formatCurrency(totals.vatAmount)}
            </Text>
          )}
          <Text>TOTALE: {formatCurrency(pdfTotal)}</Text>
        </View>

        <View style={styles.block}>
          <Text>{totals.legalNotes}</Text>
          {totals.stampDutyAmount > 0 && (
            <Text>
              Imposta di bollo da € 2,00 assolta in modo virtuale ai sensi del
              D.M. 17/06/2014
            </Text>
          )}
        </View>

        <View style={styles.block}>
          <Text>{sender.name}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function generateInvoicePdfBuffer(props: InvoicePdfProps): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');

  const element = React.createElement(InvoicePdfDocument, props) as React.ReactElement<any>;
  const buffer = await renderToBuffer(element);
  return Buffer.from(buffer);
}
