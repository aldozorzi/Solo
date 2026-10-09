import { create } from 'xmlbuilder2';
import { User, TaxRegime } from '@prisma/client';
import type {
  DecryptedClient,
  DecryptedInvoice,
  DecryptedInvoiceItem,
  DecryptedPayment,
} from './data-encryption';
import { InvoiceTotals } from './tax';

const FATTURE_NS = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';
const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';

export interface SdiConfig {
  sender: {
    idPaese: string;
    idCodice: string;
    codiceFiscale: string;
    denominazione: string;
    regimeFiscale: string;
    address: {
      indirizzo: string;
      numeroCivico: string;
      cap: string;
      comune: string;
      provincia: string;
      nazione: string;
    };
    contacts?: {
      telefono?: string;
      email?: string;
    };
  };
  progressivoInvio: string;
}

export interface InvoiceDataForXml {
  invoice: DecryptedInvoice & {
    client: DecryptedClient;
    items: DecryptedInvoiceItem[];
    payments: DecryptedPayment[];
  };
  totals: InvoiceTotals;
  config: SdiConfig;
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function formatDateForXml(date: Date | string): string {
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

function formatDecimal(value: number | string | { toString: () => string }): string {
  const num = typeof value === 'number' ? value : parseFloat(value.toString());
  return num.toFixed(2);
}

function getRegimeFiscaleCode(taxRegime: TaxRegime): string {
  return taxRegime === 'FORFETTARIO' ? 'RF19' : 'RF01';
}

/**
 * Progressivo univoco del file (max 5 caratteri alfanumerici, All. A §1.2.2):
 * 2 cifre anno + 3 cifre numero (supporta fino a 999 fatture/anno).
 */
export function invoiceProgressivo(invoice: { number: number; year: number }): string {
  const year2 = String(invoice.year).slice(-2);
  if (invoice.number <= 999) {
    return `${year2}${String(invoice.number).padStart(3, '0')}`;
  }
  return String(invoice.number).slice(-5);
}

export type SdiUserInfo = Pick<
  User,
  | 'vatNumber'
  | 'taxCode'
  | 'businessName'
  | 'taxRegime'
  | 'address'
  | 'zipCode'
  | 'city'
  | 'province'
  | 'country'
  | 'email'
>;

export function userToSdiConfig(user: SdiUserInfo): SdiConfig {
  return {
    sender: {
      idPaese: 'IT',
      idCodice: user.vatNumber,
      codiceFiscale: user.taxCode,
      denominazione: user.businessName,
      regimeFiscale: getRegimeFiscaleCode(user.taxRegime),
      address: {
        indirizzo: user.address,
        numeroCivico: 'SNC',
        cap: user.zipCode,
        comune: user.city,
        provincia: user.province || 'RM',
        nazione: user.country || 'IT',
      },
      contacts: {
        email: user.email,
      },
    },
    progressivoInvio: '1',
  };
}

function clientProvinceFromCountry(country: string, zipCode: string): string {
  if (country !== 'IT') return '';
  const provinceMap: Record<string, string> = {
    '001': 'RM', '101': 'TO', '201': 'MI', '301': 'VE', '401': 'BO',
    '501': 'FI', '601': 'AN', '701': 'BA', '801': 'NA', '901': 'PA',
  };
  const prefix = (zipCode || '').substring(0, 3);
  return provinceMap[prefix] || 'RM';
}

interface RiepilogoGroup {
  aliquota: number;
  natura: string;
  normativeRef: string;
  subtotal: number;
  vatAmount: number;
}

export function generateFatturaPAXml(data: InvoiceDataForXml): string {
  const { invoice, totals, config } = data;
  const { client, items } = invoice;
  const sender = config.sender;

  const invoiceDate = formatDateForXml(invoice.date);
  const progressivoInvio = config.progressivoInvio || '1';

  const clientSdiCode = client.sdiCode || (client.type === 'ITALY' ? '0000000' : 'XXXXXXX');
  const clientCountry = client.country || 'IT';
  const clientZipCode = client.zipCode || '00000';
  const clientCity = client.city || 'N/A';
  const clientAddress = client.address || 'N/A';

  const hasVatRate = (totals.vatRate || 0) !== 0;

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('FatturaElettronica', {
    xmlns: FATTURE_NS,
    'xmlns:ds': DS_NS,
    versione: 'FPR12',
    SistemaEmittente: 'Solo',
  });

  // ---------- HEADER ----------
  // All. A / errore FeX 370: il namespace di default sul nodo radice va azzerato
  // sui nodi Header e Body (lo schema è elementFormDefault=unqualified).
  const header = root.ele('FatturaElettronicaHeader', { xmlns: '' });

  const dt = header.ele('DatiTrasmissione');
  const idTrasm = dt.ele('IdTrasmittente');
  idTrasm.ele('IdPaese').txt(sender.idPaese);
  idTrasm.ele('IdCodice').txt(sender.idCodice);
  dt.ele('ProgressivoInvio').txt(progressivoInvio);
  dt.ele('FormatoTrasmissione').txt('FPR12');
  dt.ele('CodiceDestinatario').txt(clientSdiCode);
  if (sender.contacts?.email) {
    const ct = dt.ele('ContattiTrasmittente');
    ct.ele('Email').txt(truncate(sender.contacts.email, 256));
  }

  const ced = header.ele('CedentePrestatore');
  const cedAnag = ced.ele('DatiAnagrafici');
  const cedIva = cedAnag.ele('IdFiscaleIVA');
  cedIva.ele('IdPaese').txt(sender.idPaese);
  cedIva.ele('IdCodice').txt(sender.idCodice);
  cedAnag.ele('CodiceFiscale').txt(sender.codiceFiscale);
  cedAnag.ele('Anagrafica').ele('Denominazione').txt(truncate(sender.denominazione, 80));
  cedAnag.ele('RegimeFiscale').txt(sender.regimeFiscale);
  const cedSede = ced.ele('Sede');
  cedSede.ele('Indirizzo').txt(truncate(sender.address.indirizzo, 60));
  cedSede.ele('NumeroCivico').txt(truncate(sender.address.numeroCivico, 8));
  cedSede.ele('CAP').txt(sender.address.cap);
  cedSede.ele('Comune').txt(truncate(sender.address.comune, 60));
  cedSede.ele('Provincia').txt(sender.address.provincia);
  cedSede.ele('Nazione').txt(sender.address.nazione);

  const ces = header.ele('CessionarioCommittente');
  const cesAnag = ces.ele('DatiAnagrafici');
  // All. A §2.1.4 / errore 00417: almeno uno tra IdFiscaleIVA e CodiceFiscale.
  // Per i soggetti esteri senza identificativo si usa IdPaese + codice convenzionale
  // (lo SdI non valida in Anagrafe gli identificativi non IT).
  if (client.vatNumber) {
    const cesIva = cesAnag.ele('IdFiscaleIVA');
    cesIva.ele('IdPaese').txt(clientCountry);
    cesIva.ele('IdCodice').txt(client.vatNumber);
  } else if (client.type !== 'ITALY') {
    const cesIva = cesAnag.ele('IdFiscaleIVA');
    cesIva.ele('IdPaese').txt(clientCountry);
    cesIva.ele('IdCodice').txt('0000000');
  }
  if (client.taxCode) {
    cesAnag.ele('CodiceFiscale').txt(client.taxCode);
  }
  cesAnag.ele('Anagrafica').ele('Denominazione').txt(truncate(client.name, 80));
  const cesSede = ces.ele('Sede');
  cesSede.ele('Indirizzo').txt(truncate(clientAddress, 60));
  cesSede.ele('NumeroCivico').txt('SNC');
  cesSede.ele('CAP').txt(clientZipCode);
  cesSede.ele('Comune').txt(truncate(clientCity, 60));
  if (clientCountry === 'IT') {
    cesSede.ele('Provincia').txt(clientProvinceFromCountry(clientCountry, clientZipCode));
  }
  // Nazione è obbligatoria in Sede anche per i soggetti esteri (errore FeX 142).
  cesSede.ele('Nazione').txt(clientCountry);
  if (sender.contacts?.email) {
    const cedContatti = ced.ele('Contatti');
    cedContatti.ele('Email').txt(truncate(sender.contacts.email, 256));
  }
  

  // ---------- BODY ----------
  const body = root.ele('FatturaElettronicaBody', { xmlns: '' });
  const dg = body.ele('DatiGenerali');
  const dgd = dg.ele('DatiGeneraliDocumento');
  dgd.ele('TipoDocumento').txt('TD01');
  dgd.ele('Divisa').txt('EUR');
  dgd.ele('Data').txt(invoiceDate);
  dgd.ele('Numero').txt(String(invoice.number));
  if (totals.stampDutyAmount > 0) {
    const bollo = dgd.ele('DatiBollo');
    bollo.ele('BolloVirtuale').txt('SI');
    bollo.ele('ImportoBollo').txt(formatDecimal(totals.stampDutyAmount));
  }
  // DatiRitenuta (solo per libero professionista in ordinario verso Italia)
  if (totals.hasWithholding && totals.withholdingAmount > 0) {
    const ritenuta = dgd.ele('DatiRitenuta');
    ritenuta.ele('TipoRitenuta').txt('RT01');
    ritenuta.ele('ImportoRitenuta').txt(formatDecimal(totals.withholdingAmount));
    ritenuta.ele('AliquotaRitenuta').txt('20.00');
    ritenuta.ele('CausalePagamento').txt('A');
  }
  dgd.ele('ImportoTotaleDocumento').txt(formatDecimal(totals.totalAmount));
  // Causale: aggiungi riferimento ritenuta se presente
  const causale = totals.hasWithholding
    ? `${totals.legalNotes}. Ritenuta d'acconto 20% ai sensi del DPR 600/73.`
    : totals.legalNotes;
  dgd.ele('Causale').txt(truncate(causale, 200));

  const dbs = body.ele('DatiBeniServizi');

  items.forEach((item, index) => {
    const line = dbs.ele('DettaglioLinee');
    line.ele('NumeroLinea').txt(String(index + 1));
    line.ele('Descrizione').txt(truncate(item.description, 1000));
    line.ele('Quantita').txt('1.00');
    line.ele('UnitaMisura').txt('NR');
    line.ele('PrezzoUnitario').txt(formatDecimal(item.amount));
    line.ele('PrezzoTotale').txt(formatDecimal(item.amount));
    line.ele('AliquotaIVA').txt((totals.vatRate || 0).toFixed(2));
    // Ritenuta d'acconto: flag obbligatorio in DettaglioLinee (All. A §2.2.6)
    if (totals.hasWithholding) {
      line.ele('Ritenuta').txt('SI');
    }
    // Natura SOLO se aliquota zero (errori 00400/00401/00429/00430).
    // RiferimentoNormativo NON esiste in DettaglioLinee: solo in DatiRiepilogo.
    if (!hasVatRate && totals.vatNatureCode) {
      line.ele('Natura').txt(totals.vatNatureCode);
    }
  });

  // DatiRiepilogo raggruppati per aliquota (errore 00422: ImponibileImporto
  // = somma dei PrezzoTotale delle linee con stessa aliquota).
  const groups = new Map<number, RiepilogoGroup>();
  items.forEach((item) => {
    const key = Math.round((totals.vatRate || 0) * 100);
    const g = groups.get(key) || {
      aliquota: totals.vatRate || 0,
      natura: totals.vatNatureCode,
      normativeRef: totals.normativeRef || '',
      subtotal: 0,
      vatAmount: 0,
    };
    g.subtotal = Math.round((g.subtotal + Number(item.amount)) * 100) / 100;
    groups.set(key, g);
  });
  groups.forEach((g) => {
    g.vatAmount = Math.round(g.subtotal * (g.aliquota / 100) * 100) / 100;
    const rie = dbs.ele('DatiRiepilogo');
    rie.ele('AliquotaIVA').txt(g.aliquota.toFixed(2));
    if (!hasVatRate && g.natura) {
      rie.ele('Natura').txt(g.natura);
    }
    rie.ele('ImponibileImporto').txt(formatDecimal(g.subtotal));
    rie.ele('Imposta').txt(formatDecimal(g.vatAmount));
    rie.ele('EsigibilitaIVA').txt('I');
    if (!hasVatRate && g.normativeRef) {
      rie.ele('RiferimentoNormativo').txt(truncate(g.normativeRef, 100));
    }
  });

  const dp = body.ele('DatiPagamento');
  const paymentCount = invoice.payments.length;

  // Calcolo Netto a Pagare secondo la logica richiesta:
  // 1. Totale Documento = imponibile + IVA (totals.totalAmount)
  // 2. Se ritenuta d'acconto: netto = totale - ritenuta; altrimenti netto = totale
  const totaleDocumento = totals.totalAmount;
  const nettoAPagare = totals.hasWithholding
    ? Math.round((totaleDocumento - totals.withholdingAmount) * 100) / 100
    : totaleDocumento;

  if (paymentCount === 1) {
    // Un solo pagamento → TP02, un DettaglioPagamento con il netto a pagare
    dp.ele('CondizioniPagamento').txt('TP02');
    const p = invoice.payments[0];
    const dett = dp.ele('DettaglioPagamento');
    dett.ele('ModalitaPagamento').txt('MP05');
    const paidDate = formatDateForXml(p.paidAt);
    dett.ele('DataRiferimentoTerminiPagamento').txt(paidDate);
    dett.ele('DataScadenzaPagamento').txt(paidDate);
    dett.ele('ImportoPagamento').txt(formatDecimal(nettoAPagare));
  } else if (paymentCount > 1) {
    // Più pagamenti → TP01, ripartisco il netto a pagare in modo EQUO
    // tra tutte le rate (divisione matematica pulita, non basata sui vecchi importi)
    dp.ele('CondizioniPagamento').txt('TP01');
    const quotaBase = Math.round((nettoAPagare / paymentCount) * 100) / 100;
    let remaining = nettoAPagare;
    invoice.payments.forEach((p, idx) => {
      const dett = dp.ele('DettaglioPagamento');
      dett.ele('ModalitaPagamento').txt('MP05');
      const paidDate = formatDateForXml(p.paidAt);
      dett.ele('DataRiferimentoTerminiPagamento').txt(paidDate);
      dett.ele('DataScadenzaPagamento').txt(paidDate);
      let importo: number;
      if (idx === invoice.payments.length - 1) {
        // Ultimo pagamento: uso il resto per far quadrare i centesimi
        importo = Math.round(remaining * 100) / 100;
      } else {
        importo = quotaBase;
        remaining -= importo;
      }
      dett.ele('ImportoPagamento').txt(formatDecimal(importo));
    });
  } else {
    // Nessun pagamento → TP02, un DettaglioPagamento con il netto a pagare
    dp.ele('CondizioniPagamento').txt('TP02');
    const dett = dp.ele('DettaglioPagamento');
    dett.ele('ModalitaPagamento').txt('MP05');
    dett.ele('DataRiferimentoTerminiPagamento').txt(invoiceDate);
    dett.ele('DataScadenzaPagamento').txt(invoiceDate);
    dett.ele('ImportoPagamento').txt(formatDecimal(nettoAPagare));
  }

  return doc.end({ prettyPrint: true });
}

/**
 * Nome file SdI-compliant (All. A §1.2.2): IT + identificativo + _ + progressivo(≤5).
 */
export function generateFileName(invoice: { number: number; year: number }, config: SdiConfig): string {
  const senderVat = config.sender.idCodice || '00000000000';
  return `IT${senderVat}_${invoiceProgressivo(invoice)}.xml`;
}
