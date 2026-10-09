import { cookies } from 'next/headers';
import type { ClientType, InvoiceStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  decryptField,
  encryptField,
  unwrapWithPassword,
  unwrapWithMasterKey,
} from './crypto';

type PrismaClientLike = typeof prisma;

// -----------------------------------------------------------------------------
// TIPI DECIFRATI (forma "in chiaro" esposta dalle API)
// -----------------------------------------------------------------------------

export type DecryptedClient = {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  type: ClientType;
  vatNumber: string | null;
  taxCode: string | null;
  sdiCode: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  country: string | null;
};

export type DecryptedPayment = {
  id: string;
  userId: string;
  clientId: string;
  amount: number;
  currency: string;
  originalAmount: number | null;
  originalCurrency: string | null;
  paidAt: Date;
  description: string;
  invoiceId: string | null;
  createdAt: Date;
  client?: DecryptedClient;
  invoice?: DecryptedInvoice | null;
};

export type DecryptedInvoiceItem = {
  id: string;
  invoiceId: string;
  description: string;
  amount: number;
};

export type DecryptedInvoice = {
  id: string;
  userId: string;
  number: number;
  year: number;
  date: Date;
  clientId: string;
  subtotalAmount: number;
  stampDutyAmount: number;
  totalAmount: number;
  notes: string | null;
  status: InvoiceStatus;
  createdAt: Date;
  updatedAt: Date;
  client?: DecryptedClient;
  items?: DecryptedInvoiceItem[];
  payments?: DecryptedPayment[];
};

const DEK_COOKIE = 'zk-dek';

// -----------------------------------------------------------------------------
// RECUPERO DELLA DEK DI SESSIONE
// -----------------------------------------------------------------------------

/**
 * Recupera la DEK utente.
 * - Se il cookie di sessione `zk-dek` è presente, lo usa (percorso veloce).
 * - Altrimenti:
 *   · utente **standard**: ricava la DEK da W_sys con la MASTER_KEY (sempre
 *     disponibile lato server) — così una sessione senza cookie non manda in 500;
 *   · utente **Zero-Knowledge**: W_sys non è sbloccabile dal server; serve la
 *     password (se fornita) o il cookie, altrimenti login richiesto.
 */
export async function getUserDek(
  userId?: string,
  password?: string,
  db?: PrismaClientLike
): Promise<Buffer> {
  const fromCookie = async (): Promise<Buffer | null> => {
    try {
      const cookieStore = await cookies();
      const dekCookie = cookieStore.get(DEK_COOKIE);
      return dekCookie?.value ? Buffer.from(dekCookie.value, 'base64') : null;
    } catch {
      // Nessun contesto di richiesta (es. test).
      return null;
    }
  };

  const client = db ?? prisma;

  if (userId) {
    const userKey = await client.userKey.findUnique({ where: { userId } });
    if (userKey) {
      if (userKey.zeroKnowledgeMode) {
        if (password) return unwrapWithPassword(userKey, password);
        const cookieDek = await fromCookie();
        if (cookieDek) return cookieDek;
        throw new Error('DEK non trovata in sessione: login richiesto');
      }
      const cookieDek = await fromCookie();
      if (cookieDek) return cookieDek;
      return unwrapWithMasterKey(userKey);
    }
  }

  const cookieDek = await fromCookie();
  if (cookieDek) return cookieDek;

  throw new Error('DEK non trovata in sessione: login richiesto');
}

/**
 * Recupera la DEK usando la password (cambio password, reset, ecc.).
 */
export async function getUserDekWithPassword(userId: string, password: string): Promise<Buffer> {
  const userKey = await prisma.userKey.findUnique({ where: { userId } });
  if (!userKey) throw new Error('UserKey non trovata per utente');
  return unwrapWithPassword(userKey, password);
}

// -----------------------------------------------------------------------------
// DECIFRATURA RIGHE
// -----------------------------------------------------------------------------

type RawClient = {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  type: string;
  nameEnc: string;
  nameIv: string;
  vatNumberEnc: string | null;
  vatNumberIv: string | null;
  taxCodeEnc: string | null;
  taxCodeIv: string | null;
  sdiCodeEnc: string | null;
  sdiCodeIv: string | null;
  addressEnc: string | null;
  addressIv: string | null;
  cityEnc: string | null;
  cityIv: string | null;
  zipCodeEnc: string | null;
  zipCodeIv: string | null;
  countryEnc: string | null;
  countryIv: string | null;
};

type RawPayment = {
  id: string;
  userId: string;
  clientId: string;
  amountEnc: string;
  amountIv: string;
  currencyEnc: string;
  currencyIv: string;
  originalAmountEnc: string | null;
  originalAmountIv: string | null;
  originalCurrencyEnc: string | null;
  originalCurrencyIv: string | null;
  paidAtEnc: string;
  paidAtIv: string;
  descriptionEnc: string;
  descriptionIv: string;
  invoiceId: string | null;
  createdAt: Date;
};

type RawInvoice = {
  id: string;
  userId: string;
  number: number;
  year: number;
  dateEnc: string;
  dateIv: string;
  clientId: string;
  subtotalAmountEnc: string;
  subtotalAmountIv: string;
  stampDutyAmountEnc: string;
  stampDutyAmountIv: string;
  totalAmountEnc: string;
  totalAmountIv: string;
  notesEnc: string | null;
  notesIv: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type RawInvoiceItem = {
  id: string;
  invoiceId: string;
  descriptionEnc: string;
  descriptionIv: string;
  amountEnc: string;
  amountIv: string;
};

function decOptional(ct: string | null, iv: string | null, dek: Buffer): string | null {
  if (!ct || !iv) return null;
  return decryptField({ ciphertext: ct, iv }, dek);
}

export function decryptClient(client: RawClient, dek: Buffer): DecryptedClient {
  return {
    id: client.id,
    userId: client.userId,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    name: decryptField({ ciphertext: client.nameEnc, iv: client.nameIv }, dek),
    type: client.type as ClientType,
    vatNumber: decOptional(client.vatNumberEnc, client.vatNumberIv, dek),
    taxCode: decOptional(client.taxCodeEnc, client.taxCodeIv, dek),
    sdiCode: decOptional(client.sdiCodeEnc, client.sdiCodeIv, dek),
    address: decOptional(client.addressEnc, client.addressIv, dek),
    city: decOptional(client.cityEnc, client.cityIv, dek),
    zipCode: decOptional(client.zipCodeEnc, client.zipCodeIv, dek),
    country: decOptional(client.countryEnc, client.countryIv, dek),
  };
}

export function decryptPayment(payment: RawPayment, dek: Buffer): DecryptedPayment {
  return {
    id: payment.id,
    userId: payment.userId,
    clientId: payment.clientId,
    amount: parseFloat(decryptField({ ciphertext: payment.amountEnc, iv: payment.amountIv }, dek)),
    currency: decryptField({ ciphertext: payment.currencyEnc, iv: payment.currencyIv }, dek),
    originalAmount: payment.originalAmountEnc
      ? parseFloat(decryptField({ ciphertext: payment.originalAmountEnc, iv: payment.originalAmountIv! }, dek))
      : null,
    originalCurrency: decOptional(payment.originalCurrencyEnc, payment.originalCurrencyIv, dek),
    paidAt: new Date(decryptField({ ciphertext: payment.paidAtEnc, iv: payment.paidAtIv }, dek)),
    description: decryptField({ ciphertext: payment.descriptionEnc, iv: payment.descriptionIv }, dek),
    invoiceId: payment.invoiceId ?? null,
    createdAt: payment.createdAt,
  };
}

export function decryptInvoice(invoice: RawInvoice, dek: Buffer): DecryptedInvoice {
  return {
    id: invoice.id,
    userId: invoice.userId,
    number: invoice.number,
    year: invoice.year,
    date: new Date(decryptField({ ciphertext: invoice.dateEnc, iv: invoice.dateIv }, dek)),
    clientId: invoice.clientId,
    subtotalAmount: parseFloat(decryptField({ ciphertext: invoice.subtotalAmountEnc, iv: invoice.subtotalAmountIv }, dek)),
    stampDutyAmount: parseFloat(decryptField({ ciphertext: invoice.stampDutyAmountEnc, iv: invoice.stampDutyAmountIv }, dek)),
    totalAmount: parseFloat(decryptField({ ciphertext: invoice.totalAmountEnc, iv: invoice.totalAmountIv }, dek)),
    notes: decOptional(invoice.notesEnc, invoice.notesIv, dek),
    status: invoice.status as InvoiceStatus,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

export function decryptInvoiceItem(item: RawInvoiceItem, dek: Buffer): DecryptedInvoiceItem {
  return {
    id: item.id,
    invoiceId: item.invoiceId,
    description: decryptField({ ciphertext: item.descriptionEnc, iv: item.descriptionIv }, dek),
    amount: parseFloat(decryptField({ ciphertext: item.amountEnc, iv: item.amountIv }, dek)),
  };
}

// -----------------------------------------------------------------------------
// CIFRATURA INPUT
// -----------------------------------------------------------------------------

export function encryptClientInput(input: {
  name: string;
  type: ClientType;
  vatNumber?: string | null;
  taxCode?: string | null;
  sdiCode?: string | null;
  address?: string | null;
  city?: string | null;
  zipCode?: string | null;
  country?: string | null;
}, dek: Buffer) {
  const name = encryptField(input.name, dek);
  const vatNumber = input.vatNumber ? encryptField(input.vatNumber, dek) : null;
  const taxCode = input.taxCode ? encryptField(input.taxCode, dek) : null;
  const sdiCode = input.sdiCode ? encryptField(input.sdiCode, dek) : null;
  const address = input.address ? encryptField(input.address, dek) : null;
  const city = input.city ? encryptField(input.city, dek) : null;
  const zipCode = input.zipCode ? encryptField(input.zipCode, dek) : null;
  const country = input.country ? encryptField(input.country, dek) : null;
  return {
    nameEnc: name.ciphertext,
    nameIv: name.iv,
    type: input.type,
    vatNumberEnc: vatNumber?.ciphertext ?? null,
    vatNumberIv: vatNumber?.iv ?? null,
    taxCodeEnc: taxCode?.ciphertext ?? null,
    taxCodeIv: taxCode?.iv ?? null,
    sdiCodeEnc: sdiCode?.ciphertext ?? null,
    sdiCodeIv: sdiCode?.iv ?? null,
    addressEnc: address?.ciphertext ?? null,
    addressIv: address?.iv ?? null,
    cityEnc: city?.ciphertext ?? null,
    cityIv: city?.iv ?? null,
    zipCodeEnc: zipCode?.ciphertext ?? null,
    zipCodeIv: zipCode?.iv ?? null,
    countryEnc: country?.ciphertext ?? null,
    countryIv: country?.iv ?? null,
  };
}

/**
 * Come encryptClientInput ma per UPDATE parziali: cifra solo i campi presenti.
 */
export function encryptClientPatch(input: {
  name?: string;
  type?: ClientType;
  vatNumber?: string | null;
  taxCode?: string | null;
  sdiCode?: string | null;
  address?: string | null;
  city?: string | null;
  zipCode?: string | null;
  country?: string | null;
}, dek: Buffer) {
  const out: Record<string, unknown> = {};
  const put = (base: string, value: string | null | undefined, encrypt = true) => {
    if (value === undefined) return;
    if (value === null || value === '') {
      out[`${base}Enc`] = null;
      out[`${base}Iv`] = null;
      return;
    }
    if (!encrypt) {
      out[base] = value;
      return;
    }
    const e = encryptField(value, dek);
    out[`${base}Enc`] = e.ciphertext;
    out[`${base}Iv`] = e.iv;
  };
  if (input.name !== undefined) put('name', input.name);
  if (input.type !== undefined) out.type = input.type;
  put('vatNumber', input.vatNumber);
  put('taxCode', input.taxCode);
  put('sdiCode', input.sdiCode);
  put('address', input.address);
  put('city', input.city);
  put('zipCode', input.zipCode);
  put('country', input.country);
  return out;
}

export function encryptPaymentInput(input: {
  amount: number;
  currency: string;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  paidAt: Date;
  description: string;
}, dek: Buffer) {
  const amount = encryptField(input.amount.toString(), dek);
  const currency = encryptField(input.currency, dek);
  const originalAmount = input.originalAmount ? encryptField(input.originalAmount.toString(), dek) : null;
  const originalCurrency = input.originalCurrency ? encryptField(input.originalCurrency, dek) : null;
  const paidAt = encryptField(input.paidAt.toISOString(), dek);
  const description = encryptField(input.description, dek);
  return {
    amountEnc: amount.ciphertext,
    amountIv: amount.iv,
    currencyEnc: currency.ciphertext,
    currencyIv: currency.iv,
    originalAmountEnc: originalAmount?.ciphertext ?? null,
    originalAmountIv: originalAmount?.iv ?? null,
    originalCurrencyEnc: originalCurrency?.ciphertext ?? null,
    originalCurrencyIv: originalCurrency?.iv ?? null,
    paidAtEnc: paidAt.ciphertext,
    paidAtIv: paidAt.iv,
    descriptionEnc: description.ciphertext,
    descriptionIv: description.iv,
  };
}

export function encryptInvoiceInput(input: {
  number: number;
  year: number;
  date: Date;
  clientId: string;
  subtotalAmount: number;
  stampDutyAmount: number;
  totalAmount: number;
  notes?: string | null;
  status: InvoiceStatus;
}, dek: Buffer) {
  const date = encryptField(input.date.toISOString(), dek);
  const subtotalAmount = encryptField(input.subtotalAmount.toString(), dek);
  const stampDutyAmount = encryptField(input.stampDutyAmount.toString(), dek);
  const totalAmount = encryptField(input.totalAmount.toString(), dek);
  const notes = input.notes ? encryptField(input.notes, dek) : null;
  return {
    number: input.number,
    year: input.year,
    dateEnc: date.ciphertext,
    dateIv: date.iv,
    clientId: input.clientId,
    subtotalAmountEnc: subtotalAmount.ciphertext,
    subtotalAmountIv: subtotalAmount.iv,
    stampDutyAmountEnc: stampDutyAmount.ciphertext,
    stampDutyAmountIv: stampDutyAmount.iv,
    totalAmountEnc: totalAmount.ciphertext,
    totalAmountIv: totalAmount.iv,
    notesEnc: notes?.ciphertext ?? null,
    notesIv: notes?.iv ?? null,
    status: input.status,
  };
}

export function encryptInvoiceItemInput(input: {
  description: string;
  amount: number;
}, dek: Buffer) {
  const description = encryptField(input.description, dek);
  const amount = encryptField(input.amount.toString(), dek);
  return {
    descriptionEnc: description.ciphertext,
    descriptionIv: description.iv,
    amountEnc: amount.ciphertext,
    amountIv: amount.iv,
  };
}
