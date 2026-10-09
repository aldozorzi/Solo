import { 
  Client, 
  Invoice, 
  InvoiceItem, 
  Payment, 
  User,
  ClientType, 
  InvoiceStatus,
  TaxRegime,
  UserRole,
  SenderType
} from '@prisma/client';

export type { Client, Invoice, InvoiceItem, Payment, User, ClientType, InvoiceStatus, TaxRegime, UserRole, SenderType };
export type { DecryptedClient, DecryptedInvoice, DecryptedInvoiceItem, DecryptedPayment };

// Forme "in chiaro" restituite dalle API (campi sensibili decifrati con gli stessi
// nomi legacy: il frontend non distingue tra plaintext DB e ciphertext decifrato).
import type {
  DecryptedClient,
  DecryptedInvoice,
  DecryptedInvoiceItem,
  DecryptedPayment,
} from '@/lib/data-encryption';

export type InvoiceWithRelations = DecryptedInvoice & {
  client: DecryptedClient;
  items: DecryptedInvoiceItem[];
  payments: DecryptedPayment[];
};

export type ClientWithRelations = DecryptedClient & {
  payments: DecryptedPayment[];
  invoices: DecryptedInvoice[];
  _count?: {
    payments: number;
    invoices: number;
  };
};

export type PaymentWithRelations = DecryptedPayment & {
  client: DecryptedClient;
  invoice?: DecryptedInvoice | null;
};

export type UserSession = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  businessName: string;
  vatNumber: string;
  taxCode: string;
  address: string;
  city: string;
  zipCode: string;
  country: string;
  province?: string | null;
  taxRegime: TaxRegime;
  senderType: SenderType;
  sessionVersion?: number;
  mfa?: boolean;
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  ITALY: 'Italia',
  EU: 'Unione Europea',
  EXTRA_EU: 'Extra-UE',
};

export const CLIENT_TYPE_SDI_DEFAULTS: Record<ClientType, { sdiCode: string; zipCode: string }> = {
  ITALY: { sdiCode: '0000000', zipCode: '' },
  EU: { sdiCode: 'XXXXXXX', zipCode: '00000' },
  EXTRA_EU: { sdiCode: 'XXXXXXX', zipCode: '00000' },
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Bozza',
  ISSUED: 'Emessa',
  PAID: 'Saldata',
  CANCELLED: 'Annullata',
};

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ISSUED: 'bg-blue-100 text-blue-700',
  PAID: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  FORFETTARIO: 'Forfettario',
  ORDINARIO: 'Ordinario',
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Amministratore',
  USER: 'Utente',
};