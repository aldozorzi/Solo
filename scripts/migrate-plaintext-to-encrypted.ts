/**
 * Migrazione una-tantum plaintext -> cifrato (doppio involucro).
 *
 * Per ogni utente senza UserKey:
 *  - crea UserKey "pending" (solo W_sys; W_pwd stabilito al prossimo reset password);
 *  - cifra tutte le sue righe Client/Payment/Invoice/InvoiceItem con la DEK.
 *
 * Idempotente: salta righe già cifrate e utenti con UserKey esistente.
 * Eseguire DOPO la parte additiva dello schema e PRIMA del DROP delle colonne plaintext.
 */
import { PrismaClient } from '@prisma/client';
import { createPendingUserKey, encryptField } from '@/lib/crypto';

const prisma = new PrismaClient();

type PlainClient = {
  id: string;
  name: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  sdiCode: string | null;
  address: string | null;
  city: string | null;
  zipCode: string | null;
  country: string | null;
  nameEnc: string | null;
};

type PlainPayment = {
  id: string;
  amount: unknown;
  currency: string | null;
  originalAmount: unknown;
  originalCurrency: string | null;
  paidAt: Date | null;
  description: string | null;
  amountEnc: string | null;
};

type PlainInvoice = {
  id: string;
  date: Date | null;
  subtotalAmount: unknown;
  stampDutyAmount: unknown;
  totalAmount: unknown;
  notes: string | null;
  subtotalAmountEnc: string | null;
};

type PlainItem = {
  id: string;
  description: string | null;
  amount: unknown;
  descriptionEnc: string | null;
};

const enc = (v: string, dek: Buffer) => encryptField(v, dek);
const num = (v: unknown) => String(v);

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log(`Utenti da migrare: ${users.length}`);

  for (const user of users) {
    const existing = await prisma.userKey.findUnique({ where: { userId: user.id } });
    let dek: Buffer;
    if (existing) {
      console.log(`- ${user.email}: UserKey esistente, riuso W_sys`);
      const { unwrapKey, MASTER_KEY } = await import('@/lib/crypto');
      dek = unwrapKey(existing.wSys, MASTER_KEY);
    } else {
      const pending = createPendingUserKey();
      dek = pending.dek;
      await prisma.userKey.create({
        data: {
          userId: user.id,
          argon2Salt: pending.argon2Salt.toString('base64'),
          wPwd: pending.wPwd,
          wSys: pending.wSys,
        },
      });
      console.log(`- ${user.email}: UserKey pending creata`);
    }

    const clients = await prisma.$queryRaw<PlainClient[]>`
      SELECT id, name, "vatNumber", "taxCode", "sdiCode", address, city, "zipCode", country, "nameEnc"
      FROM "Client" WHERE "userId" = ${user.id}`;
    let nClients = 0;
    for (const c of clients) {
      if (c.nameEnc || c.name === null) continue;
      const e = (v: string | null) => (v === null ? null : enc(v, dek));
      const put = (v: ReturnType<typeof e>) =>
        v ? { ciphertext: v.ciphertext, iv: v.iv } : { ciphertext: null as string | null, iv: null as string | null };
      const name = put(e(c.name)!);
      const vat = put(e(c.vatNumber));
      const tax = put(e(c.taxCode));
      const sdi = put(e(c.sdiCode));
      const addr = put(e(c.address));
      const city = put(e(c.city));
      const zip = put(e(c.zipCode));
      const country = put(e(c.country));
      await prisma.client.update({
        where: { id: c.id },
        data: {
          nameEnc: name.ciphertext!, nameIv: name.iv!,
          vatNumberEnc: vat.ciphertext, vatNumberIv: vat.iv,
          taxCodeEnc: tax.ciphertext, taxCodeIv: tax.iv,
          sdiCodeEnc: sdi.ciphertext, sdiCodeIv: sdi.iv,
          addressEnc: addr.ciphertext, addressIv: addr.iv,
          cityEnc: city.ciphertext, cityIv: city.iv,
          zipCodeEnc: zip.ciphertext, zipCodeIv: zip.iv,
          countryEnc: country.ciphertext, countryIv: country.iv,
        },
      });
      nClients++;
    }

    const payments = await prisma.$queryRaw<PlainPayment[]>`
      SELECT id, amount, currency, "originalAmount", "originalCurrency", "paidAt", description, "amountEnc"
      FROM "Payment" WHERE "userId" = ${user.id}`;
    let nPayments = 0;
    for (const p of payments) {
      if (p.amountEnc || p.amount === null) continue;
      const amount = enc(num(p.amount), dek);
      const currency = enc(p.currency ?? 'EUR', dek);
      const paidAt = enc((p.paidAt as Date).toISOString(), dek);
      const description = enc(p.description ?? '', dek);
      const origAmount = p.originalAmount !== null ? enc(num(p.originalAmount), dek) : null;
      const origCurrency = p.originalCurrency !== null ? enc(p.originalCurrency, dek) : null;
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          amountEnc: amount.ciphertext, amountIv: amount.iv,
          currencyEnc: currency.ciphertext, currencyIv: currency.iv,
          paidAtEnc: paidAt.ciphertext, paidAtIv: paidAt.iv,
          descriptionEnc: description.ciphertext, descriptionIv: description.iv,
          originalAmountEnc: origAmount?.ciphertext ?? null,
          originalAmountIv: origAmount?.iv ?? null,
          originalCurrencyEnc: origCurrency?.ciphertext ?? null,
          originalCurrencyIv: origCurrency?.iv ?? null,
        },
      });
      nPayments++;
    }

    const invoices = await prisma.$queryRaw<PlainInvoice[]>`
      SELECT id, date, "subtotalAmount", "stampDutyAmount", "totalAmount", notes, "subtotalAmountEnc"
      FROM "Invoice" WHERE "userId" = ${user.id}`;
    let nInvoices = 0;
    for (const inv of invoices) {
      if (inv.subtotalAmountEnc || inv.date === null) continue;
      const date = enc((inv.date as Date).toISOString(), dek);
      const sub = enc(num(inv.subtotalAmount), dek);
      const stamp = enc(num(inv.stampDutyAmount), dek);
      const total = enc(num(inv.totalAmount), dek);
      const notes = inv.notes !== null ? enc(inv.notes, dek) : null;
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          dateEnc: date.ciphertext, dateIv: date.iv,
          subtotalAmountEnc: sub.ciphertext, subtotalAmountIv: sub.iv,
          stampDutyAmountEnc: stamp.ciphertext, stampDutyAmountIv: stamp.iv,
          totalAmountEnc: total.ciphertext, totalAmountIv: total.iv,
          notesEnc: notes?.ciphertext ?? null, notesIv: notes?.iv ?? null,
        },
      });
      nInvoices++;
    }

    const items = await prisma.$queryRaw<PlainItem[]>`
      SELECT i.id, i.description, i.amount, i."descriptionEnc"
      FROM "InvoiceItem" i JOIN "Invoice" inv ON inv.id = i."invoiceId"
      WHERE inv."userId" = ${user.id}`;
    let nItems = 0;
    for (const it of items) {
      if (it.descriptionEnc || it.description === null) continue;
      const description = enc(it.description, dek);
      const amount = enc(num(it.amount), dek);
      await prisma.invoiceItem.update({
        where: { id: it.id },
        data: {
          descriptionEnc: description.ciphertext, descriptionIv: description.iv,
          amountEnc: amount.ciphertext, amountIv: amount.iv,
        },
      });
      nItems++;
    }

    console.log(`  clienti=${nClients} pagamenti=${nPayments} fatture=${nInvoices} righe=${nItems}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
