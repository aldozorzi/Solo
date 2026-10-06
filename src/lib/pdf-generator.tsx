import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { Invoice, Client, InvoiceItem, Payment, User, TaxRegime } from '@prisma/client';
import { InvoiceTotals } from './tax';
import { formatCurrency, formatDate } from './tax';

Font.register({
  family: 'Helvetica',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/npm/@react-pdf/renderer@3.4.0/fonts/Helvetica.afm', fontWeight: 'normal' },
    { src: 'https://cdn.jsdelivr.net/npm/@react-pdf/renderer@3.4.0/fonts/Helvetica-Bold.afm', fontWeight: 'bold' },
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

function getRegimeLabel(taxRegime: TaxRegime): string {
  return taxRegime === 'FORFETTARIO' 
    ? 'Regime forfettario art. 1, commi 54-89, L. 190/2014'
    : 'Regime ordinario';
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
    padding: 30,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  companyInfo: {
    width: '50%',
  },
  invoiceInfo: {
    width: '45%',
    textAlign: 'right',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontWeight: 'bold',
    fontSize: 11,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  label: {
    fontWeight: 'bold',
    width: 120,
  },
  value: {
    flex: 1,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    padding: 8,
    fontWeight: 'bold',
    borderBottomWidth: 1,
    borderBottomColor: '#000',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#ccc',
  },
  colDesc: { width: '60%' },
  colQty: { width: '10%', textAlign: 'center' },
  colUnit: { width: '10%', textAlign: 'center' },
  colPrice: { width: '20%', textAlign: 'right' },
  totalsSection: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#000',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  totalLabel: {
    fontWeight: 'bold',
  },
  totalValue: {
    textAlign: 'right',
    width: 100,
  },
  grandTotal: {
    fontSize: 12,
    fontWeight: 'bold',
    borderTopWidth: 1,
    borderTopColor: '#000',
    paddingTop: 10,
    marginTop: 10,
  },
  notes: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 9,
  },
  stampNote: {
    marginTop: 10,
    fontStyle: 'italic',
    fontSize: 9,
  },
  footer: {
    marginTop: 30,
    textAlign: 'center',
    fontSize: 8,
    color: '#666',
  },
  clientInfo: {
    width: '50%',
  },
});

function CompanyInfo({ sender, title }: { sender: SenderInfo; title: string }) {
  return (
    <View style={styles.companyInfo}>
      <Text style={styles.title}>{title}</Text>
      <Text style={{ fontWeight: 'bold' }}>{sender.name}</Text>
      <Text>{sender.address}, {sender.zipCode} {sender.city} ({sender.province})</Text>
      <Text>P.IVA: {sender.vatNumber}</Text>
      <Text>C.F.: {sender.taxCode}</Text>
      <Text>Regime: {getRegimeLabel(sender.taxRegime)}</Text>
      {sender.email && <Text>Email: {sender.email}</Text>}
      {sender.phone && <Text>Tel: {sender.phone}</Text>}
    </View>
  );
}

function ClientInfo({ client }: { client: Client }) {
  return (
    <View style={styles.clientInfo}>
      <Text style={{ fontWeight: 'bold' }}>{client.name}</Text>
      {client.vatNumber && <Text>P.IVA: {client.vatNumber}</Text>}
      {client.taxCode && <Text>C.F.: {client.taxCode}</Text>}
      <Text>{client.address || 'N/A'}</Text>
      <Text>{client.zipCode || '00000'} {client.city || 'N/A'} ({client.country})</Text>
    </View>
  );
}

function InvoiceDetails({ invoice, totals }: { invoice: Invoice; totals: InvoiceTotals }) {
  return (
    <View style={styles.invoiceInfo}>
      <Text style={styles.title}>FATTURA</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Numero:</Text>
        <Text style={styles.value}>{invoice.number}/{invoice.year}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Data:</Text>
        <Text style={styles.value}>{formatDate(invoice.date)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Totale:</Text>
        <Text style={styles.value}>{formatCurrency(totals.totalAmount)}</Text>
      </View>
    </View>
  );
}

function ItemsTable({ items, vatNatureCode, legalNotes }: { items: InvoiceItem[]; vatNatureCode: string; legalNotes: string }) {
  return (
    <View>
      <View style={styles.tableHeader}>
        <Text style={{ ...styles.colDesc }}>Descrizione</Text>
        <Text style={{ ...styles.colQty }}>Qtà</Text>
        <Text style={{ ...styles.colUnit }}>UM</Text>
        <Text style={{ ...styles.colPrice }}>Prezzo</Text>
      </View>
      {items.map((item, index) => (
        <View key={item.id} style={styles.tableRow}>
          <Text style={{ ...styles.colDesc }}>{item.description}</Text>
          <Text style={{ ...styles.colQty }}>1</Text>
          <Text style={{ ...styles.colUnit }}>NR</Text>
          <Text style={{ ...styles.colPrice }}>{formatCurrency(item.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function TotalsSection({ totals, legalNotes }: { totals: InvoiceTotals; legalNotes: string }) {
  return (
    <View style={styles.totalsSection}>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Imponibile</Text>
        <Text style={styles.totalValue}>{formatCurrency(totals.subtotal)}</Text>
      </View>
      {totals.vatAmount > 0 && (
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>IVA ({totals.vatRate}%)</Text>
          <Text style={styles.totalValue}>{formatCurrency(totals.vatAmount)}</Text>
        </View>
      )}
      {totals.stampDutyAmount > 0 && (
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Imposta di bollo (virtuale)</Text>
          <Text style={styles.totalValue}>{formatCurrency(totals.stampDutyAmount)}</Text>
        </View>
      )}
      <View style={[styles.totalRow, styles.grandTotal]}>
        <Text style={styles.totalLabel}>Totale</Text>
        <Text style={styles.totalValue}>{formatCurrency(totals.totalAmount)}</Text>
      </View>
    </View>
  );
}

function NotesSection({ legalNotes, stampDutyAmount }: { legalNotes: string; stampDutyAmount: number }) {
  return (
    <View style={styles.notes}>
      <Text style={styles.sectionTitle}>Note e diciture fiscali</Text>
      <Text>{legalNotes}</Text>
      {stampDutyAmount > 0 && (
        <Text style={styles.stampNote}>
          Imposta di bollo da € 2,00 assolta in modo virtuale ai sensi del D.M. 17/06/2014
        </Text>
      )}
    </View>
  );
}

export function InvoicePdfDocument(props: InvoicePdfProps) {
  const { invoice, totals, sender } = props;
  const { client, items, payments } = invoice;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <CompanyInfo sender={sender} title="CEDENTE / PRESTATORE" />
          <InvoiceDetails invoice={invoice} totals={totals} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cessionario / Committente</Text>
          <ClientInfo client={client} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dettaglio prestazioni</Text>
          <ItemsTable items={items} vatNatureCode={totals.vatNatureCode} legalNotes={totals.legalNotes} />
        </View>

        <TotalsSection totals={totals} legalNotes={totals.legalNotes} />

        <NotesSection legalNotes={totals.legalNotes} stampDutyAmount={totals.stampDutyAmount} />

        <View style={styles.footer}>
          <Text>Documento generato da Solo - Gestionale Fatture</Text>
          <Text>Fattura elettronica XML disponibile per invio al SdI (Fatture e Corrispettivi)</Text>
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