export type ClientType = 'ITALY' | 'EU' | 'EXTRA_EU';
export type TaxRegime = 'FORFETTARIO' | 'ORDINARIO';

export interface CalculateInvoiceInput {
  subtotal: number;
  clientType: ClientType;
  taxRegime: TaxRegime;
}

export interface InvoiceTotals {
  subtotal: number;
  stampDutyAmount: number;
  totalAmount: number;
  vatNatureCode: string;
  legalNotes: string;
  vatAmount: number;
  vatRate: number;
}

const FORFETTARIO_STAMP_THRESHOLD = 77.47;
const STAMP_DUTY_AMOUNT = 2.0;

export function calculateInvoiceTotals({
  subtotal,
  clientType,
  taxRegime,
}: CalculateInvoiceInput): InvoiceTotals {
  if (taxRegime === 'FORFETTARIO') {
    return calculateForfettarioTotals({ subtotal, clientType });
  }
  
  return calculateOrdinarioTotals({ subtotal, clientType });
}

function calculateForfettarioTotals({
  subtotal,
  clientType,
}: { subtotal: number; clientType: ClientType }): InvoiceTotals {
  const requiresStamp = subtotal > FORFETTARIO_STAMP_THRESHOLD;
  const stampDutyAmount = requiresStamp ? STAMP_DUTY_AMOUNT : 0.0;
  const totalAmount = subtotal + stampDutyAmount;

  let vatNatureCode = 'N2.2';
  let legalNotes = "Operazione effettuata ai sensi dell'art. 1, commi da 54 a 89, Legge n. 190/2014 e succ. modifiche";

  if (clientType === 'EU') {
    vatNatureCode = 'N3.2';
    legalNotes = 'Operazione non imponibile IVA / Reverse Charge. Regime forfettario art. 1, commi 54-89, L. 190/2014';
  } else if (clientType === 'EXTRA_EU') {
    vatNatureCode = 'N2.2';
    legalNotes = "Operazione non soggetta ad IVA ai sensi dell'art. 7-ter del D.P.R. 633/1972. Regime forfettario art. 1, commi 54-89, L. 190/2014";
  }

  return {
    subtotal,
    stampDutyAmount,
    totalAmount,
    vatNatureCode,
    legalNotes,
    vatAmount: 0,
    vatRate: 0,
  };
}

function calculateOrdinarioTotals({
  subtotal,
  clientType,
}: { subtotal: number; clientType: ClientType }): InvoiceTotals {
  const requiresStamp = subtotal > FORFETTARIO_STAMP_THRESHOLD;
  const stampDutyAmount = requiresStamp ? STAMP_DUTY_AMOUNT : 0.0;

  let vatNatureCode = 'N2.2';
  let legalNotes = '';
  let vatRate = 0;
  let vatAmount = 0;

  if (clientType === 'ITALY') {
    vatRate = 22;
    vatAmount = subtotal * (vatRate / 100);
    vatNatureCode = 'N1';
    legalNotes = 'Operazione soggetta ad IVA 22% - Regime ordinario';
  } else if (clientType === 'EU') {
    vatNatureCode = 'N3.2';
    legalNotes = 'Operazione non imponibile IVA / Reverse Charge intracomunitario - Regime ordinario';
  } else if (clientType === 'EXTRA_EU') {
    vatNatureCode = 'N2.2';
    legalNotes = "Operazione non soggetta ad IVA ai sensi dell'art. 7-ter del D.P.R. 633/1972 - Regime ordinario";
  }

  const totalAmount = subtotal + vatAmount + stampDutyAmount;

  return {
    subtotal,
    stampDutyAmount,
    totalAmount,
    vatNatureCode,
    legalNotes,
    vatAmount,
    vatRate,
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

export function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('it-IT');
}

export function generateInvoiceNumber(year: number, lastNumber: number): { number: number; year: number } {
  return { number: lastNumber + 1, year };
}