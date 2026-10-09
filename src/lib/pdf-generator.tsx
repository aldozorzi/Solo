import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, type DocumentProps } from '@react-pdf/renderer';
import { User, TaxRegime } from '@prisma/client';
import type {
  DecryptedClient,
  DecryptedInvoice,
  DecryptedInvoiceItem,
  DecryptedPayment,
} from './data-encryption';
import { InvoiceTotals, formatCurrency, formatDate } from './tax';
import {
  buildRicevutaContent,
  formatClientAddress,
  formatPaymentLine,
  formatSenderAddress,
} from './ricevuta-content';

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

export type SenderUserInfo = Pick<
  User,
  | 'businessName'
  | 'vatNumber'
  | 'taxCode'
  | 'address'
  | 'city'
  | 'zipCode'
  | 'province'
  | 'country'
  | 'taxRegime'
>;

export function userToSenderInfo(user: SenderUserInfo): SenderInfo {
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
  invoice: DecryptedInvoice & {
    client: DecryptedClient;
    items: DecryptedInvoiceItem[];
    payments: DecryptedPayment[];
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

/**
 * Ricevuta per prestazione occasionale (art. 67, lett. l, D.P.R. 917/1986).
 * Ricalca in tutto e per tutto la ricevuta di riferimento (SPECS/ricevuta.pdf):
 * intestazione RICEVUTA, emittente senza P.IVA, cliente senza codici fiscali,
 * accrediti dinamici con doppi importi, TOTALE LORDO e note legali di regime.
 * Le righe di ritenuta/netto compaiono solo quando la ritenuta si applica
 * (caso non presente nel riferimento, che è verso non residente).
 */
export function RicevutaPdfDocument(props: InvoicePdfProps) {
  const content = buildRicevutaContent(props);
  const blocks: string[][] = [
    content.header,
    content.emitter,
    content.client,
    content.oggetto,
    content.payments,
    content.totals,
    content.notes,
    content.signature,
  ];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {blocks.map((lines, blockIndex) => (
          <View key={blockIndex} style={styles.block}>
            {lines.map((line, lineIndex) => (
              <Text key={lineIndex}>{line}</Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function generateRicevutaPdfBuffer(props: InvoicePdfProps): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');

  const element = React.createElement(RicevutaPdfDocument, props) as unknown as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return Buffer.from(buffer);
}

export async function generateInvoicePdfBuffer(props: InvoicePdfProps): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');

  // renderToBuffer vuole un <Document>: il cast è solo di forma, il componente
  // radice di InvoicePdfDocument è Document.
  const element = React.createElement(InvoicePdfDocument, props) as unknown as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(element);
  return Buffer.from(buffer);
}
