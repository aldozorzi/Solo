/**
 * Suite ricevuta per prestazione occasionale (art. 67, lett. l, D.P.R. 917/1986).
 *
 * Verifica, senza server né DB:
 *  1. la logica fiscale `calculateOccasionaleTotals` (niente IVA, ritenuta 20%
 *     solo verso IT sostituti, diciture esatte per tipo cliente);
 *  2. che `RicevutaPdfDocument` ricalchi in tutto e per tutto la ricevuta di
 *     riferimento (SPECS/ricevuta.pdf), con accrediti dinamici.
 */
import {
  calculateInvoiceTotals,
  WITHHOLDING_RATE_OCCASIONALE,
} from '../../src/lib/tax';
import {
  buildRicevutaContent,
  flattenRicevutaContent,
  type RicevutaInvoice,
} from '../../src/lib/ricevuta-content';
import type {
  DecryptedClient,
  DecryptedInvoiceItem,
  DecryptedPayment,
} from '../../src/lib/data-encryption';
import type { InvoiceTotals } from '../../src/lib/tax';

const SENDER = {
  name: 'Aldo Zorzi',
  vatNumber: 'IT00743110157',
  taxCode: 'ZRZLDA82M09D969K',
  address: 'Via Rohrbach 44',
  city: 'Pragelato',
  zipCode: '10060',
  province: 'TO',
  country: 'IT',
  taxRegime: 'PRESTAZIONE_OCCASIONALE' as const,
};

const EXTRA_EU_CLIENT: DecryptedClient = {
  id: 'client-us',
  userId: 'user-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  name: 'Surge Labs, Inc.',
  type: 'EXTRA_EU',
  vatNumber: null,
  taxCode: null,
  sdiCode: 'XXXXXXX',
  address: '2193 Fillmore St, San Francisco, CA 94115',
  city: '',
  zipCode: '',
  country: 'United States',
};

const OGGETTO =
  "Compilazione ed elaborazione dati (prestazione autonoma occasionale ai sensi dell'art. 67, lett. l, D.P.R. 917/1986). " +
  'Corrispettivo relativo ai servizi resi nel mese di Agosto 2026:';

function makePayments(): DecryptedPayment[] {
  return [
    {
      id: 'pay-1',
      userId: 'user-1',
      clientId: 'client-us',
      amount: 393.12,
      currency: 'EUR',
      originalAmount: 454.26,
      originalCurrency: 'USD',
      paidAt: new Date('2026-08-10T00:00:00.000Z'),
      description: 'Acconto agosto',
      invoiceId: 'inv-1',
      createdAt: new Date('2026-08-10'),
    },
    {
      id: 'pay-2',
      userId: 'user-1',
      clientId: 'client-us',
      amount: 1290.88,
      currency: 'EUR',
      originalAmount: 1505.43,
      originalCurrency: 'USD',
      paidAt: new Date('2026-08-25T00:00:00.000Z'),
      description: 'Saldo agosto',
      invoiceId: 'inv-1',
      createdAt: new Date('2026-08-25'),
    },
  ];
}

function makeInvoice(client: DecryptedClient, subtotal: number): RicevutaInvoice {
  const items: DecryptedInvoiceItem[] = [
    { id: 'item-1', invoiceId: 'inv-1', description: OGGETTO, amount: subtotal },
  ];
  return {
    number: 1,
    year: 2026,
    date: new Date('2026-08-31T00:00:00.000Z'),
    client,
    items,
    payments: makePayments(),
  };
}

describe('prestazione occasionale: totali', () => {
  test('EXTRA_EU: niente IVA, niente ritenuta, dicitura del riferimento', () => {
    const totals = calculateInvoiceTotals({
      subtotal: 1684,
      clientType: 'EXTRA_EU',
      taxRegime: 'PRESTAZIONE_OCCASIONALE',
      senderType: 'LIBERO_PROFESSIONISTA',
    });
    expect(totals.vatAmount).toBe(0);
    expect(totals.vatRate).toBe(0);
    expect(totals.hasWithholding).toBe(false);
    expect(totals.withholdingAmount).toBe(0);
    expect(totals.stampDutyAmount).toBe(0);
    expect(totals.totalAmount).toBe(1684);
    expect(totals.legalNotes).toBe(
      'Trattandosi di prestazione resa a soggetto non residente, non si applica la ritenuta ' +
        "d'acconto (art. 25 D.P.R. 600/1973). " +
        "Operazione fuori campo IVA ai sensi dell'art. 5 D.P.R. 633/1972. " +
        "Si dichiara che il compenso è percepito nell'ambito di prestazioni di lavoro autonomo occasionale."
    );
  });

  test('EU: niente ritenuta, nota reverse charge', () => {
    const totals = calculateInvoiceTotals({
      subtotal: 500,
      clientType: 'EU',
      taxRegime: 'PRESTAZIONE_OCCASIONALE',
      senderType: 'DITTA_INDIVIDUALE',
    });
    expect(totals.hasWithholding).toBe(false);
    expect(totals.withholdingAmount).toBe(0);
    expect(totals.totalAmount).toBe(500);
    expect(totals.legalNotes).toContain('soggetto UE non residente');
    expect(totals.legalNotes).toContain("art. 5 D.P.R. 633/1972");
  });

  test('ITALY con P.IVA: ritenuta 20% (sostituto)', () => {
    const totals = calculateInvoiceTotals({
      subtotal: 1000,
      clientType: 'ITALY',
      taxRegime: 'PRESTAZIONE_OCCASIONALE',
      senderType: 'LIBERO_PROFESSIONISTA',
      clientVatNumber: '09725440011',
    });
    expect(totals.hasWithholding).toBe(true);
    expect(totals.withholdingAmount).toBe(200);
    expect(totals.totalAmount).toBe(1000);
    expect(totals.legalNotes).toContain("ritenuta d'acconto del 20%");
  });

  test('ITALY senza P.IVA: nessuna ritenuta (privato)', () => {
    for (const clientVatNumber of [null, '', '   ']) {
      const totals = calculateInvoiceTotals({
        subtotal: 1000,
        clientType: 'ITALY',
        taxRegime: 'PRESTAZIONE_OCCASIONALE',
        senderType: 'SOCIETA',
        clientVatNumber,
      });
      expect(totals.hasWithholding).toBe(false);
      expect(totals.withholdingAmount).toBe(0);
      expect(totals.legalNotes).toContain('non sostituto');
    }
  });

  test('WITHHOLDING_RATE_OCCASIONALE vale 20%', () => {
    expect(WITHHOLDING_RATE_OCCASIONALE).toBe(0.2);
  });
});

describe('prestazione occasionale: contenuto ricevuta PDF', () => {
  test('ricalca SPECS/ricevuta.pdf con accrediti dinamici', () => {
    const invoice = makeInvoice(EXTRA_EU_CLIENT, 1684);
    const totals: InvoiceTotals = calculateInvoiceTotals({
      subtotal: 1684,
      clientType: 'EXTRA_EU',
      taxRegime: 'PRESTAZIONE_OCCASIONALE',
      senderType: 'LIBERO_PROFESSIONISTA',
    });

    const text = flattenRicevutaContent(
      buildRicevutaContent({ invoice, totals, sender: SENDER })
    ).join('\n');

    // Intestazione e date come nel riferimento.
    expect(text).toContain('RICEVUTA N. 1/2026');
    expect(text).toContain('Data: 31/08/2026');
    // Emittente: nome + CF senza prefissi, senza P.IVA, con indirizzo.
    expect(text).toContain('EMESSA DA:');
    expect(text).toContain('Aldo Zorzi');
    expect(text).toContain('ZRZLDA82M09D969K');
    expect(text).toContain('Via Rohrbach 44');
    expect(text).not.toMatch(/P\.IVA/);
    expect(text).not.toMatch(/C\.F\./);
    // Cliente: nome + indirizzo, senza codici.
    expect(text).toContain('NEI CONFRONTI DI:');
    expect(text).toContain('Surge Labs, Inc.');
    expect(text).toContain('2193 Fillmore St, San Francisco, CA 94115');
    // Oggetto dinamico dalle righe.
    expect(text).toContain('OGGETTO:');
    expect(text).toContain('Compilazione ed elaborazione dati');
    expect(text).toContain('Corrispettivo relativo ai servizi resi nel mese di Agosto 2026:');
    // Accrediti dinamici con doppi importi, ordinati per data.
    // (il separatore delle migliaia dipende dai dati ICU di Node: tollerato con `\.?`)
    expect(text).toMatch(/Accredito del 10\/08\/2026: 454\.26 \$ \(pari a 393,12/);
    expect(text).toMatch(/Accredito del 25\/08\/2026: 1505\.43 \$ \(pari a 1\.?290,88/);
    expect(
      text.indexOf('10/08/2026') < text.indexOf('25/08/2026')
    ).toBe(true);
    // Totale lordo come nel riferimento, niente IVA.
    expect(text).toContain('TOTALE LORDO:');
    expect(text).toMatch(/1\.?684,00/);
    expect(text).not.toMatch(/IVA \(/);
    // Note legali del riferimento.
    expect(text).toContain('non si applica la ritenuta');
    expect(text).toContain('art. 5');
    expect(text).toContain('lavoro autonomo occasionale');
    // Firma.
    expect(text.endsWith('Aldo Zorzi')).toBe(true);
    // Mai "FATTURA" in una ricevuta.
    expect(text).not.toMatch(/FATTURA/);
  });

  test('ITALY con ritenuta: mostra ritenuta e netto', () => {
    const itClient: DecryptedClient = {
      ...EXTRA_EU_CLIENT,
      id: 'client-it',
      type: 'ITALY',
      name: 'Cliente Italia',
      vatNumber: '09725440011',
      address: 'Via Roma 1',
      country: 'IT',
    };
    const invoice = makeInvoice(itClient, 1000);
    invoice.payments = [];
    invoice.items = [{ id: 'item-1', invoiceId: 'inv-1', description: 'Consulenza', amount: 1000 }];
    const totals: InvoiceTotals = calculateInvoiceTotals({
      subtotal: 1000,
      clientType: 'ITALY',
      taxRegime: 'PRESTAZIONE_OCCASIONALE',
      senderType: 'LIBERO_PROFESSIONISTA',
      clientVatNumber: '09725440011',
    });

    const text = flattenRicevutaContent(
      buildRicevutaContent({ invoice, totals, sender: SENDER })
    ).join('\n');

    expect(text).toContain('RICEVUTA N. 1/2026');
    expect(text).toContain('TOTALE LORDO:');
    expect(text).toContain("Ritenuta d'acconto (20%):");
    expect(text).toContain('200,00');
    expect(text).toContain('NETTO A PAGARE:');
    expect(text).toContain('800,00');
  });
});
