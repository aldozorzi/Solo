export type ClientType = 'ITALY' | 'EU' | 'EXTRA_EU';
export type TaxRegime = 'FORFETTARIO' | 'ORDINARIO';

export type SenderType = 'LIBERO_PROFESSIONISTA' | 'DITTA_INDIVIDUALE' | 'SOCIETA';

export interface CalculateInvoiceInput {
  subtotal: number;
  clientType: ClientType;
  taxRegime: TaxRegime;
  senderType: SenderType;
}

export interface InvoiceTotals {
  subtotal: number;
  stampDutyAmount: number;
  /** Totale documento: imponibile + IVA, SENZA bollo (il bollo vive solo in DatiBollo e diciture). */
  totalAmount: number;
  vatNatureCode: string;
  legalNotes: string;
  /** Riferimento normativo breve (<=100 caratteri) per DatiRiepilogo; '' se non applicabile. */
  normativeRef: string;
  vatAmount: number;
  vatRate: number;
  /** Importo ritenuta d'acconto (solo per libero professionista in ordinario verso Italia). */
  withholdingAmount: number;
  /** Indica se la fattura è soggetta a ritenuta d'acconto. */
  hasWithholding: boolean;
}

const FORFETTARIO_STAMP_THRESHOLD = 77.47;
const STAMP_DUTY_AMOUNT = 2.0;

export function calculateInvoiceTotals({
  subtotal,
  clientType,
  taxRegime,
  senderType,
}: CalculateInvoiceInput): InvoiceTotals {
  if (taxRegime === 'FORFETTARIO') {
    return calculateForfettarioTotals({ subtotal, clientType });
  }
  
  return calculateOrdinarioTotals({ subtotal, clientType, senderType });
}

function calculateForfettarioTotals({
  subtotal,
  clientType,
}: { subtotal: number; clientType: ClientType }): InvoiceTotals {
  const requiresStamp = subtotal > FORFETTARIO_STAMP_THRESHOLD;
  const stampDutyAmount = requiresStamp ? STAMP_DUTY_AMOUNT : 0.0;
  const totalAmount = subtotal;

  // Per il regime forfettario (RF19) la Natura IVA è SEMPRE N2.2
  // per qualsiasi cliente estero (UE ed Extra-UE) e per l'Italia.
  const vatNatureCode = 'N2.2';
  let legalNotes = "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, Legge n. 190/2014 e succ. modifiche";
  let normativeRef = 'Regime forfettario art.1 c.54-89 L.190/2014';

  if (clientType === 'EU') {
    legalNotes = 'Operazione non soggetta ad IVA - Regime forfettario art. 1, commi 54-89, L. 190/2014';
    normativeRef = 'Art.7-ter DPR 633/72 - forfettario L.190/2014';
  } else if (clientType === 'EXTRA_EU') {
    legalNotes = "Operazione non soggetta ad IVA ai sensi dell'art. 7-ter del D.P.R. 633/1972. Regime forfettario art. 1, commi 54-89, L. 190/2014";
    normativeRef = 'Art.7-ter DPR 633/72 - forfettario L.190/2014';
  }

  return {
    subtotal,
    stampDutyAmount,
    totalAmount,
    vatNatureCode,
    legalNotes,
    normativeRef,
    vatAmount: 0,
    vatRate: 0,
    withholdingAmount: 0,
    hasWithholding: false,
  };
}

function calculateOrdinarioTotals({
  subtotal,
  clientType,
  senderType,
}: { subtotal: number; clientType: ClientType; senderType: SenderType }): InvoiceTotals {
  // Bollo per operazioni senza IVA (Extra-UE) e imponibile > 77.47
  // NO bollo per: clienti Italia con IVA 22%, clienti UE (servizi intra-UE)
  const vatRate = clientType === 'ITALY' ? 22 : 0;
  const requiresStamp = vatRate === 0 && clientType !== 'EU' && clientType !== 'ITALY' && subtotal > FORFETTARIO_STAMP_THRESHOLD;
  const stampDutyAmount = requiresStamp ? STAMP_DUTY_AMOUNT : 0.0;

  let vatNatureCode = 'N2.2';
  let legalNotes = '';
  let normativeRef = '';
  let vatAmount = 0;
  let withholdingAmount = 0;
  let hasWithholding = false;

  if (clientType === 'ITALY') {
    vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    vatNatureCode = '';
    legalNotes = 'Operazione soggetta ad IVA 22% - Regime ordinario';
    normativeRef = '';
    // Ritenuta d'acconto 20% solo per libero professionista in ordinario verso Italia
    if (senderType === 'LIBERO_PROFESSIONISTA') {
      withholdingAmount = Math.round(subtotal * 0.20 * 100) / 100;
      hasWithholding = true;
    }
  } else if (clientType === 'EU') {
    // Prestazioni di servizi intra-UE B2B in regime ordinario: N2.1 (non soggette art. 7-ter DPR 633/72)
    vatNatureCode = 'N2.1';
    legalNotes = 'Operazione non soggetta ad IVA ai sensi dell\'art. 7-ter DPR 633/72 - Reverse Charge intracomunitario';
    normativeRef = 'Art. 7-ter DPR 633/72 - Reverse Charge intra-UE';
  } else if (clientType === 'EXTRA_EU') {
    vatNatureCode = 'N2.2';
    legalNotes = "Operazione non soggetta ad IVA ai sensi dell'art. 7-ter del D.P.R. 633/1972 - Regime ordinario";
    normativeRef = 'Art.7-ter DPR 633/72 - regime ordinario';
  }

  const totalAmount = subtotal + vatAmount;

  return {
    subtotal,
    stampDutyAmount,
    totalAmount,
    vatNatureCode,
    legalNotes,
    normativeRef,
    vatAmount,
    vatRate,
    withholdingAmount,
    hasWithholding,
  };
}

export function formatCurrency(amount: number | { toString: () => string }): string {
  const num = typeof amount === 'number' ? amount : parseFloat(amount.toString());
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(num);
}

type DecimalLike = number | { toString: () => string } | null | undefined;

function toNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : parseFloat(value.toString());
  return Number.isNaN(num) ? null : num;
}

export function currencySymbol(code: string): string {
  const upper = code.toUpperCase();
  if (upper === 'USD') return '$';
  if (upper === 'EUR') return '€';
  if (upper === 'GBP') return '£';
  return code.toUpperCase();
}

export function formatForeignAmount(amount: DecimalLike, currencyCode: string): string | null {
  const num = toNumber(amount);
  if (num === null) return null;
  const upper = currencyCode.toUpperCase();
  if (upper === 'EUR') return formatCurrency(num);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(num);
  return `${formatted} ${currencySymbol(upper)}`;
}

/**
 * Mostra l'importo in EUR, con eventuale controvalore in valuta originale.
 * La doppia valuta è mostrata solo per clienti EXTRA_EU e solo se
 * originalAmount/originalCurrency sono valorizzati (altrimenti solo EUR).
 * Formato esteso con "pari a", come nella ricevuta di riferimento.
 */
export function formatDualAmount(
  eurAmount: DecimalLike,
  originalAmount: DecimalLike,
  originalCurrency: string | null | undefined,
  clientType: ClientType
): string {
  const eurNum = toNumber(eurAmount) ?? 0;
  const eurFormatted = formatCurrency(eurNum);
  if (clientType !== 'EXTRA_EU') return eurFormatted;
  const origNum = toNumber(originalAmount);
  const origCode = (originalCurrency || '').trim().toUpperCase();
  if (origNum === null || !origCode || origCode === 'EUR') return eurFormatted;
  const origFormatted = formatForeignAmount(origNum, origCode);
  if (!origFormatted) return eurFormatted;
  return `${origFormatted} (pari a ${eurFormatted})`;
}

/**
 * Variante compatta per gli elenchi UI: "400.00 $ (354,96 €)".
 * Stesse regole di formatDualAmount, senza il "pari a".
 */
export function formatDualAmountShort(
  eurAmount: DecimalLike,
  originalAmount: DecimalLike,
  originalCurrency: string | null | undefined,
  clientType: ClientType
): string {
  const eurNum = toNumber(eurAmount) ?? 0;
  const eurFormatted = formatCurrency(eurNum);
  if (clientType !== 'EXTRA_EU') return eurFormatted;
  const origNum = toNumber(originalAmount);
  const origCode = (originalCurrency || '').trim().toUpperCase();
  if (origNum === null || !origCode || origCode === 'EUR') return eurFormatted;
  const origFormatted = formatForeignAmount(origNum, origCode);
  if (!origFormatted) return eurFormatted;
  return `${origFormatted} (${eurFormatted})`;
}

export function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('it-IT');
}

export function generateInvoiceNumber(year: number, lastNumber: number): { number: number; year: number } {
  return { number: lastNumber + 1, year };
}