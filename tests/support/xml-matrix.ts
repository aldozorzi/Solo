import type { PrismaClient } from '@prisma/client';
import {
  calculateInvoiceTotals,
  type ClientType,
  type InvoiceTotals,
  type SenderType,
  type TaxRegime,
} from '../../src/lib/tax';
import {
  generateFatturaPAXml,
  userToSdiConfig,
  invoiceProgressivo,
} from '../../src/lib/xml-generator';

export const SUBTOTAL = 532.44;
export const VAT_RATE_ITALY = 22;
export const WITHHOLDING_RATE = 0.2;
export const STAMP_THRESHOLD = 77.47;
export const STAMP_AMOUNT = 2;

export const SENDER_TYPES = ['LIBERO_PROFESSIONISTA', 'DITTA_INDIVIDUALE', 'SOCIETA'] as const;
export const TAX_REGIMES = ['FORFETTARIO', 'ORDINARIO'] as const;
export type MatrixTaxRegime = TaxRegime | 'RF19' | 'RF01';

export function canonicalTaxRegime(taxRegime: MatrixTaxRegime): TaxRegime {
  if (taxRegime === 'RF19') return 'FORFETTARIO';
  if (taxRegime === 'RF01') return 'ORDINARIO';
  return taxRegime;
}

export interface ClientProfile {
  clientType: ClientType;
  fileLabel: 'clienteIT' | 'clienteDE' | 'clienteUS';
  country: 'IT' | 'DE' | 'US';
  vatNumber: string;
  taxCode: string | null;
  sdiCode: string;
  name: string;
  city: string;
  zipCode: string;
}

export const CLIENT_PROFILES: ClientProfile[] = [
  {
    clientType: 'ITALY',
    fileLabel: 'clienteIT',
    country: 'IT',
    vatNumber: '09725440011',
    taxCode: '09725440011',
    sdiCode: '0000000',
    name: 'Cliente Italia',
    city: 'Torino',
    zipCode: '10100',
  },
  {
    clientType: 'EU',
    fileLabel: 'clienteDE',
    country: 'DE',
    vatNumber: 'DE123456789',
    taxCode: null,
    sdiCode: 'XXXXXXX',
    name: 'Cliente Germania',
    city: 'Berlin',
    zipCode: '10115',
  },
  {
    clientType: 'EXTRA_EU',
    fileLabel: 'clienteUS',
    country: 'US',
    vatNumber: '0000000',
    taxCode: null,
    sdiCode: 'XXXXXXX',
    name: 'Cliente USA',
    city: 'New York',
    zipCode: '10001',
  },
];

export interface PaymentFixture {
  amount: number;
  paidAt: string;
}

export interface MatrixCase {
  key: string;
  senderType: (typeof SENDER_TYPES)[number];
  taxRegime: MatrixTaxRegime;
  client: ClientProfile;
  paymentCount: 1 | 2;
  paymentFixtures: PaymentFixture[];
  fileName: string;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/_/g, '-');
}

export function buildMatrixCases(): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const senderType of SENDER_TYPES) {
    for (const taxRegime of TAX_REGIMES) {
      for (const client of CLIENT_PROFILES) {
        for (const paymentCount of [1, 2] as const) {
          const paymentFixtures =
            paymentCount === 1
              ? [{ amount: 532.44, paidAt: '2026-10-06' }]
              : [
                  { amount: 354.96, paidAt: '2026-10-06' },
                  { amount: 177.48, paidAt: '2026-10-13' },
                ];
          cases.push({
            key: `${senderType}/${taxRegime}/${client.clientType}/${paymentCount}`,
            senderType,
            taxRegime,
            client,
            paymentCount,
            paymentFixtures,
            fileName: `IT00743110157_26001-${slug(senderType)}-${slug(taxRegime)}-${client.fileLabel}-${
              paymentCount === 1 ? '1pagamento' : '2pagamenti'
            }.xml`,
          });
        }
      }
    }
  }
  return cases;
}

export interface ExpectedTotals extends InvoiceTotals {
  expectedNetPayable: number;
}

export function expectedTotalsFor(
  senderType: SenderType,
  taxRegime: MatrixTaxRegime,
  clientType: ClientType,
  subtotal = SUBTOTAL
): ExpectedTotals {
  const canonicalRegime = canonicalTaxRegime(taxRegime);
  const actual = calculateInvoiceTotals({ subtotal, clientType, taxRegime: canonicalRegime, senderType });
  const stampEligible = subtotal > STAMP_THRESHOLD;
  const expected: ExpectedTotals =
    canonicalRegime === 'FORFETTARIO'
      ? {
          ...actual,
          totalAmount: subtotal,
          vatAmount: 0,
          vatRate: 0,
          vatNatureCode: 'N2.2',
          withholdingAmount: 0,
          hasWithholding: false,
          stampDutyAmount: stampEligible ? STAMP_AMOUNT : 0,
          expectedNetPayable: subtotal,
        }
      : clientType === 'ITALY'
        ? {
            ...actual,
            vatRate: VAT_RATE_ITALY,
            vatAmount: Math.round(((subtotal * VAT_RATE_ITALY) / 100) * 100) / 100,
            totalAmount: 0,
            vatNatureCode: '',
            stampDutyAmount: 0,
            withholdingAmount: 0,
            hasWithholding: false,
            expectedNetPayable: 0,
          }
        : clientType === 'EU'
          ? {
              ...actual,
              totalAmount: subtotal,
              vatAmount: 0,
              vatRate: 0,
              vatNatureCode: 'N2.1',
              withholdingAmount: 0,
              hasWithholding: false,
              stampDutyAmount: 0,
              expectedNetPayable: subtotal,
            }
          : {
              ...actual,
              totalAmount: subtotal,
              vatAmount: 0,
              vatRate: 0,
              vatNatureCode: 'N2.2',
              withholdingAmount: 0,
              hasWithholding: false,
              stampDutyAmount: stampEligible ? STAMP_AMOUNT : 0,
              expectedNetPayable: subtotal,
            };

  if (canonicalRegime === 'ORDINARIO' && clientType === 'ITALY') {
    const vatAmount = expected.vatAmount;
    const withholdingAmount = senderType === 'LIBERO_PROFESSIONISTA' ? Math.round(subtotal * WITHHOLDING_RATE * 100) / 100 : 0;
    expected.totalAmount = subtotal + vatAmount;
    expected.withholdingAmount = withholdingAmount;
    expected.hasWithholding = senderType === 'LIBERO_PROFESSIONISTA';
    expected.expectedNetPayable = expected.hasWithholding
      ? Math.round((expected.totalAmount - withholdingAmount) * 100) / 100
      : expected.totalAmount;
  }

  const mismatch: string[] = [];
  (
    [
      'subtotal',
      'totalAmount',
      'vatAmount',
      'vatRate',
      'vatNatureCode',
      'stampDutyAmount',
      'withholdingAmount',
      'hasWithholding',
    ] as const
  ).forEach((field) => {
    if (actual[field] !== expected[field]) {
      mismatch.push(`${field}: atteso ${String(expected[field])}, calcolato ${String(actual[field])}`);
    }
  });
  if (mismatch.length > 0) {
    throw new Error(`Totali fiscali non conformi: ${mismatch.join('; ')}`);
  }

  return expected;
}

export function expectedLabelsFor(
  taxRegime: MatrixTaxRegime,
  clientType: ClientType
): { legalNotes: string; normativeRef: string } {
  if (canonicalTaxRegime(taxRegime) === 'FORFETTARIO') {
    if (clientType === 'EU') {
      return {
        legalNotes: 'Operazione non soggetta ad IVA - Regime forfettario art. 1, commi 54-89, L. 190/2014',
        normativeRef: 'Art.7-ter DPR 633/72 - forfettario L.190/2014',
      };
    }
    if (clientType === 'EXTRA_EU') {
      return {
        legalNotes:
          "Operazione non soggetta ad IVA ai sensi dell'art. 7-ter del D.P.R. 633/1972. Regime forfettario art. 1, commi 54-89, L. 190/2014",
        normativeRef: 'Art.7-ter DPR 633/72 - forfettario L.190/2014',
      };
    }
    return {
      legalNotes:
        "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, Legge n. 190/2014 e succ. modifiche",
      normativeRef: 'Regime forfettario art.1 c.54-89 L.190/2014',
    };
  }

  if (clientType === 'ITALY') {
    return {
      legalNotes: 'Operazione soggetta ad IVA 22% - Regime ordinario',
      normativeRef: '',
    };
  }
  if (clientType === 'EU') {
    return {
      legalNotes:
        "Operazione non soggetta ad IVA ai sensi dell'art. 7-ter DPR 633/72 - Reverse Charge intracomunitario",
      normativeRef: 'Art. 7-ter DPR 633/72 - Reverse Charge intra-UE',
    };
  }
  return {
    legalNotes:
      "Operazione non soggetta ad IVA ai sensi dell'art. 7-ter del D.P.R. 633/1972 - Regime ordinario",
    normativeRef: 'Art.7-ter DPR 633/72 - regime ordinario',
  };
}

export function expectedPaymentShares(netPayable: number, paymentCount: number): number[] {
  if (paymentCount === 1) return [netPayable];
  const base = Math.round((netPayable / paymentCount) * 100) / 100;
  const shares = Array(paymentCount).fill(base) as number[];
  const remainder = Math.round((netPayable - base * (paymentCount - 1)) * 100) / 100;
  shares[paymentCount - 1] = remainder;
  return shares;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countTag(xml: string, tag: string): number {
  const matches = xml.match(new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>`, 'g'));
  return matches ? matches.length : 0;
}

export function tagValues(xml: string, tag: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([^<]*)</${escapeRegExp(tag)}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    values.push(match[1]);
  }
  return values;
}

export function blockValues(xml: string, blockTag: string, valueTag: string): string[][] {
  return xml
    .split(`<${blockTag}`)
    .slice(1)
    .map((block) => block.slice(0, block.indexOf(`</${blockTag}>`)))
    .map((block) => tagValues(block, valueTag));
}

function sameNumberList(actual: number[], expected: number[]): boolean {
  if (actual.length !== expected.length) return false;
  const sortedActual = [...actual].sort((a, b) => a - b);
  const sortedExpected = [...expected].sort((a, b) => a - b);
  return sortedActual.every((value, index) => Math.abs(value - sortedExpected[index]) <= 0.005);
}

export interface CombinationReport {
  caseKey: string;
  fileName: string;
  documentTotal: string;
  netPayable: string;
  payments: string[];
  nature: string;
  stamp: string;
  withholding: string;
}

export function checkCombinationXml(input: {
  matrixCase: MatrixCase;
  totals: ExpectedTotals;
  xml: string;
}): CombinationReport {
  const { matrixCase, totals, xml } = input;
  const failures: string[] = [];
  const expectedLabels = expectedLabelsFor(matrixCase.taxRegime, matrixCase.client.clientType);
  if (totals.legalNotes !== expectedLabels.legalNotes) {
    failures.push(`dicitura fiscale attesa "${expectedLabels.legalNotes}", trovata "${totals.legalNotes}"`);
  }
  if (totals.normativeRef !== expectedLabels.normativeRef) {
    failures.push(`riferimento normativo atteso "${expectedLabels.normativeRef}", trovato "${totals.normativeRef}"`);
  }
  const expectedShares = expectedPaymentShares(totals.expectedNetPayable, matrixCase.paymentCount);
  const actualShares = tagValues(xml, 'ImportoPagamento').map(Number);
  const shareSum = actualShares.reduce((sum, value) => sum + value, 0);

  if (!xml.includes('<FatturaElettronicaHeader xmlns="">')) {
    failures.push('manca xmlns="" su FatturaElettronicaHeader');
  }
  if (!xml.includes('<FatturaElettronicaBody xmlns="">')) {
    failures.push('manca xmlns="" su FatturaElettronicaBody');
  }

  const sedeBlocks = xml.split('<Sede>').slice(1).map((block) => block.slice(0, block.indexOf('</Sede>')));
  if (sedeBlocks.length !== 2) {
    failures.push(`attese 2 Sede, trovate ${sedeBlocks.length}`);
  } else {
    if (!sedeBlocks[0].includes('<Nazione>IT</Nazione>')) failures.push('manca Nazione IT del cedente');
    if (!sedeBlocks[1].includes(`<Nazione>${matrixCase.client.country}</Nazione>`)) {
      failures.push(`manca Nazione ${matrixCase.client.country} del cessionario`);
    }
  }

  const canonicalRegime = canonicalTaxRegime(matrixCase.taxRegime);
  const requiresWithholding =
    canonicalRegime === 'ORDINARIO' &&
    matrixCase.senderType === 'LIBERO_PROFESSIONISTA' &&
    matrixCase.client.clientType === 'ITALY';
  const stampEligibleCombination =
    canonicalRegime === 'FORFETTARIO' ||
    (canonicalRegime === 'ORDINARIO' && matrixCase.client.clientType === 'EXTRA_EU');
  const stampForbiddenCombination =
    canonicalRegime === 'ORDINARIO' &&
    (matrixCase.client.clientType === 'EU' || matrixCase.client.clientType === 'ITALY');

  const documentTotals = tagValues(xml, 'ImportoTotaleDocumento');
  const documentTotal = documentTotals.length === 1 ? Number(documentTotals[0]) : Number.NaN;
  if (documentTotals.length !== 1 || documentTotals[0] !== totals.totalAmount.toFixed(2)) {
    failures.push(`ImportoTotaleDocumento atteso ${totals.totalAmount.toFixed(2)}, trovato ${documentTotals.join(',')}`);
  }
  if (!Number.isFinite(documentTotal)) {
    failures.push('ImportoTotaleDocumento non numerico');
  } else {
    const expectedStampByRule =
      stampEligibleCombination && documentTotal > STAMP_THRESHOLD ? STAMP_AMOUNT : 0;
    if (totals.stampDutyAmount !== expectedStampByRule) {
      failures.push(
        `Importo bollo calcolato atteso ${expectedStampByRule.toFixed(2)}, trovato ${totals.stampDutyAmount.toFixed(2)}`
      );
    }
    if (stampForbiddenCombination) {
      if (xml.includes('<DatiBollo>')) {
        failures.push('DatiBollo sempre vietato per Ordinario verso UE o Italia');
      }
    } else if (stampEligibleCombination) {
      if (documentTotal > STAMP_THRESHOLD) {
        if (countTag(xml, 'DatiBollo') !== 1) failures.push('DatiBollo obbligatorio mancante');
        if (!xml.includes(`<ImportoBollo>${STAMP_AMOUNT.toFixed(2)}</ImportoBollo>`)) {
          failures.push('ImportoBollo deve essere 2.00');
        }
      } else if (xml.includes('<DatiBollo>')) {
        failures.push('DatiBollo presente sotto o alla soglia di 77.47');
      }
    }
  }

  const expectedCausale = totals.hasWithholding
    ? `${expectedLabels.legalNotes}. Ritenuta d'acconto 20% ai sensi del DPR 600/73.`
    : expectedLabels.legalNotes;
  const causales = tagValues(xml, 'Causale');
  if (causales.length !== 1 || causales[0] !== expectedCausale) {
    failures.push(`Causale attesa "${expectedCausale}", trovata "${causales.join(',')}"`);
  }

  const expectedWithholdingAmount = Math.round(SUBTOTAL * WITHHOLDING_RATE * 100) / 100;
  if (!requiresWithholding && totals.hasWithholding) {
    failures.push('ritenuta calcolata ma non prevista da regime/tipologia/cliente');
  }
  if (requiresWithholding) {
    if (!totals.hasWithholding) failures.push('ritenuta prevista ma non calcolata');
    if (totals.withholdingAmount !== expectedWithholdingAmount) {
      failures.push(
        `Importo ritenuta calcolato atteso ${expectedWithholdingAmount.toFixed(2)}, trovato ${totals.withholdingAmount.toFixed(2)}`
      );
    }
    if (!xml.includes('<DatiRitenuta>')) failures.push('DatiRitenuta obbligatoria mancante');
    if (!xml.includes('<TipoRitenuta>RT01</TipoRitenuta>')) failures.push('TipoRitenuta deve essere RT01');
    if (!xml.includes(`<ImportoRitenuta>${expectedWithholdingAmount.toFixed(2)}</ImportoRitenuta>`)) {
      failures.push('ImportoRitenuta XML non corretto');
    }
    if (!xml.includes('<AliquotaRitenuta>20.00</AliquotaRitenuta>')) failures.push('AliquotaRitenuta deve essere 20.00');
    if (!xml.includes('<CausalePagamento>A</CausalePagamento>')) failures.push('CausalePagamento deve essere A');
    const detailRitenutaFlags = blockValues(xml, 'DettaglioLinee', 'Ritenuta');
    if (detailRitenutaFlags.length === 0) {
      failures.push('nessuna riga di dettaglio trovata per applicare la ritenuta');
    } else if (detailRitenutaFlags.some((flags) => flags.length !== 1 || flags[0] !== 'SI')) {
      failures.push('ogni DettaglioLinee deve contenere <Ritenuta>SI</Ritenuta>');
    }
  } else {
    if (xml.includes('<DatiRitenuta>')) failures.push('DatiRitenuta presente ma non dovuta');
    if (countTag(xml, 'Ritenuta') !== 0) failures.push('flag Ritenuta presente ma non dovuto');
  }

  const expectedHardNature =
    canonicalRegime === 'FORFETTARIO'
      ? 'N2.2'
      : canonicalRegime === 'ORDINARIO' && matrixCase.client.clientType === 'EU'
        ? 'N2.1'
        : canonicalRegime === 'ORDINARIO' && matrixCase.client.clientType === 'EXTRA_EU'
          ? 'N2.2'
          : '';
  if (totals.vatNatureCode !== expectedHardNature) {
    failures.push(`Natura calcolata attesa "${expectedHardNature}", trovata "${totals.vatNatureCode}"`);
  }

  const lineNatureBlocks = blockValues(xml, 'DettaglioLinee', 'Natura');
  const summaryNatureBlocks = blockValues(xml, 'DatiRiepilogo', 'Natura');
  const lineNatures = lineNatureBlocks.flat();
  const summaryNatures = summaryNatureBlocks.flat();
  if (canonicalRegime === 'FORFETTARIO') {
    if (/<Natura>N3[^<]*<\/Natura>/.test(xml)) {
      failures.push('serie N3 vietata in regime forfettario');
    }
    if (
      lineNatureBlocks.length === 0 ||
      lineNatureBlocks.some((flags) => flags.length !== 1 || flags[0] !== 'N2.2')
    ) {
      failures.push('ogni DettaglioLinee forfettario deve contenere <Natura>N2.2</Natura>');
    }
    if (
      summaryNatureBlocks.length === 0 ||
      summaryNatureBlocks.some((flags) => flags.length !== 1 || flags[0] !== 'N2.2')
    ) {
      failures.push('ogni DatiRiepilogo forfettario deve contenere <Natura>N2.2</Natura>');
    }
  } else if (canonicalRegime === 'ORDINARIO' && matrixCase.client.clientType === 'EU') {
    if (
      lineNatureBlocks.length === 0 ||
      lineNatureBlocks.some((flags) => flags.length !== 1 || flags[0] !== 'N2.1')
    ) {
      failures.push('ogni DettaglioLinee UE in ordinario deve contenere <Natura>N2.1</Natura>');
    }
    if (
      summaryNatureBlocks.length === 0 ||
      summaryNatureBlocks.some((flags) => flags.length !== 1 || flags[0] !== 'N2.1')
    ) {
      failures.push('ogni DatiRiepilogo UE in ordinario deve contenere <Natura>N2.1</Natura>');
    }
  }

  const hasVat = totals.vatRate !== 0;
  if (hasVat) {
    if (lineNatures.length > 0 || summaryNatures.length > 0) failures.push('Natura non ammessa con aliquota IVA diversa da zero');
    if (xml.includes('<RiferimentoNormativo>')) failures.push('RiferimentoNormativo non ammesso per cliente Italia in ordinario');
  } else {
    if (lineNatures.length !== 1 || lineNatures[0] !== totals.vatNatureCode) {
      failures.push(`Natura linea attesa ${totals.vatNatureCode}, trovata ${lineNatures.join(',')}`);
    }
    if (summaryNatures.length !== 1 || summaryNatures[0] !== totals.vatNatureCode) {
      failures.push(`Natura riepilogo attesa ${totals.vatNatureCode}, trovata ${summaryNatures.join(',')}`);
    }
    const references = tagValues(xml, 'RiferimentoNormativo');
    if (references.length !== 1 || references[0] !== expectedLabels.normativeRef) {
      failures.push(`RiferimentoNormativo atteso ${expectedLabels.normativeRef}, trovato ${references.join(',')}`);
    }
  }

  const summary = blockValues(xml, 'DatiRiepilogo', 'ImponibileImporto').flat();
  const taxes = blockValues(xml, 'DatiRiepilogo', 'Imposta').flat();
  if (summary.length !== 1 || summary[0] !== totals.subtotal.toFixed(2)) {
    failures.push(`ImponibileImporto atteso ${totals.subtotal.toFixed(2)}, trovato ${summary.join(',')}`);
  }
  if (taxes.length !== 1 || taxes[0] !== totals.vatAmount.toFixed(2)) {
    failures.push(`Imposta attesa ${totals.vatAmount.toFixed(2)}, trovata ${taxes.join(',')}`);
  }
  if (!xml.includes('<EsigibilitaIVA>I</EsigibilitaIVA>')) failures.push('EsigibilitaIVA deve essere I');

  const expectedCondition = matrixCase.paymentCount === 1 ? 'TP02' : 'TP01';
  const conditions = tagValues(xml, 'CondizioniPagamento');
  if (conditions.length !== 1 || conditions[0] !== expectedCondition) {
    failures.push(`CondizioniPagamento atteso ${expectedCondition}, trovato ${conditions.join(',')}`);
  }

  const paymentBlocks = xml.split('<DettaglioPagamento').slice(1);
  if (paymentBlocks.length !== matrixCase.paymentCount) {
    failures.push(`attesi ${matrixCase.paymentCount} DettaglioPagamento, trovati ${paymentBlocks.length}`);
  }
  if (!sameNumberList(actualShares, expectedShares)) {
    failures.push(
      `ImportoPagamento atteso [${expectedShares.map((value) => value.toFixed(2)).join(', ')}], ` +
        `trovato [${actualShares.map((value) => value.toFixed(2)).join(', ')}]`
    );
  }
  if (Math.abs(shareSum - totals.expectedNetPayable) > 0.005) {
    failures.push(`somma pagamenti ${shareSum.toFixed(2)} diversa dal netto ${totals.expectedNetPayable.toFixed(2)}`);
  }
  if (countTag(xml, 'ModalitaPagamento') !== matrixCase.paymentCount || tagValues(xml, 'ModalitaPagamento').some((value) => value !== 'MP05')) {
    failures.push('ogni pagamento deve usare ModalitaPagamento MP05');
  }
  const expectedDates = matrixCase.paymentFixtures.map((payment) => payment.paidAt).sort();
  const actualDates = tagValues(xml, 'DataScadenzaPagamento').sort();
  if (expectedDates.join('|') !== actualDates.join('|')) {
    failures.push(`date pagamento attese ${expectedDates.join(',')}, trovate ${actualDates.join(',')}`);
  }

  if (failures.length > 0) {
    throw new Error(`${matrixCase.key}: ${failures.join(' | ')}`);
  }

  return {
    caseKey: matrixCase.key,
    fileName: matrixCase.fileName,
    documentTotal: totals.totalAmount.toFixed(2),
    netPayable: totals.expectedNetPayable.toFixed(2),
    payments: actualShares.map((value) => value.toFixed(2)),
    nature: totals.vatNatureCode === '' ? '(IVA 22%)' : totals.vatNatureCode,
    stamp: totals.stampDutyAmount > 0 ? totals.stampDutyAmount.toFixed(2) : 'no',
    withholding: totals.hasWithholding ? totals.withholdingAmount.toFixed(2) : 'no',
  };
}

export function formatReportLine(report: CombinationReport): string {
  return `[PASS] ${report.caseKey} | totale=${report.documentTotal} netto=${report.netPayable} pagamenti=[${report.payments.join('+')}] | natura=${report.nature} bollo=${report.stamp} ritenuta=${report.withholding}`;
}

export async function createMatrixUser(
  prisma: PrismaClient,
  senderType: (typeof SENDER_TYPES)[number],
  taxRegime: MatrixTaxRegime,
  runId: string
) {
  const { generateUserKey } = await import('@/lib/crypto');
  const { randomBytes } = await import('node:crypto');
  const { wPwd, wSys, argon2Salt } = await generateUserKey(randomBytes(32).toString('hex'));
  return prisma.user.create({
    data: {
      email: `xml-matrix-${runId}-${senderType.toLowerCase()}-${taxRegime.toLowerCase()}@example.com`,
      name: `XML Matrix ${senderType} ${taxRegime}`,
      passwordHash: 'xml-matrix-test',
      businessName: `XML Matrix ${senderType} ${taxRegime}`,
      vatNumber: '00743110157',
      taxCode: 'ZRZLDA82M09D969K',
      address: 'Via Test 1',
      city: 'Torino',
      zipCode: '10100',
      country: 'IT',
      province: 'TO',
      taxRegime: canonicalTaxRegime(taxRegime) as never,
      senderType: senderType as never,
      userKey: {
        create: {
          argon2Salt: argon2Salt.toString('base64'),
          wPwd,
          wSys,
          zeroKnowledgeMode: false,
          zkSalt: null,
        },
      },
    },
  });
}

export async function createMatrixClient(prisma: PrismaClient, userId: string, client: ClientProfile) {
  const { getUserDek, encryptClientInput } = await import('@/lib/data-encryption');
  const dek = await getUserDek(userId, undefined, prisma);
  const encrypted = encryptClientInput(
    {
      name: client.name,
      type: client.clientType as 'ITALY' | 'EU' | 'EXTRA_EU',
      vatNumber: client.vatNumber,
      taxCode: client.taxCode,
      sdiCode: client.sdiCode,
      address: 'Via Roma 1',
      city: client.city,
      zipCode: client.zipCode,
      country: client.country,
    },
    dek
  );
  return prisma.client.create({ data: { userId, ...encrypted } });
}

export async function createMatrixPayments(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  fixtures: PaymentFixture[]
) {
  const { getUserDek, encryptPaymentInput } = await import('@/lib/data-encryption');
  const dek = await getUserDek(userId, undefined, prisma);
  const rows = [];
  for (const fixture of fixtures) {
    const encrypted = encryptPaymentInput(
      {
        amount: fixture.amount,
        currency: 'EUR',
        paidAt: new Date(`${fixture.paidAt}T00:00:00.000Z`),
        description: `XML Matrix ${fixture.amount}`,
      },
      dek
    );
    rows.push(await prisma.payment.create({ data: { userId, clientId, ...encrypted } }));
  }
  return rows;
}

export async function createMatrixInvoice(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  paymentIds: string[],
  invoiceNumber: number,
  totals: InvoiceTotals
) {
  const {
    getUserDek,
    encryptInvoiceInput,
    encryptInvoiceItemInput,
    decryptInvoice,
    decryptClient,
    decryptPayment,
    decryptInvoiceItem,
  } = await import('@/lib/data-encryption');
  const dek = await getUserDek(userId, undefined, prisma);
  const encrypted = encryptInvoiceInput(
    {
      number: invoiceNumber,
      year: 2026,
      date: new Date('2026-10-07T00:00:00.000Z'),
      clientId,
      subtotalAmount: totals.subtotal,
      stampDutyAmount: totals.stampDutyAmount,
      totalAmount: totals.totalAmount,
      notes: totals.legalNotes,
      status: 'ISSUED',
    },
    dek
  );
  const stored = await prisma.invoice.create({
    data: {
      userId,
      ...encrypted,
      items: {
        create: encryptInvoiceItemInput(
          { description: 'Servizio di consulenza', amount: totals.subtotal },
          dek
        ),
      },
      payments: { connect: paymentIds.map((id) => ({ id })) },
    },
    include: { client: true, items: true, payments: true },
  });
  // I generatori lavorano sulle forme decifrate (relazioni sempre presenti: include).
  const invoice = await decryptInvoice(stored, dek);
  const client = await decryptClient(stored.client, dek);
  const items = await Promise.all(stored.items.map((i) => decryptInvoiceItem(i, dek)));
  const payments = await Promise.all(stored.payments.map((p) => decryptPayment(p, dek)));
  return { ...invoice, client, items, payments };
}

export function buildMatrixXml(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
  invoice: Parameters<typeof generateFatturaPAXml>[0]['invoice'];
  totals: InvoiceTotals;
}) {
  const config = userToSdiConfig(input.user);
  config.progressivoInvio = invoiceProgressivo(input.invoice);
  return generateFatturaPAXml({ invoice: input.invoice, totals: input.totals, config });
}
