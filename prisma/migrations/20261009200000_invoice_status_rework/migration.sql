-- Nuovo modello stati: ISSUED = da saldare, PARTIALLY_PAID = parzialmente saldata,
-- PAID = saldata, CANCELLED invariato. DRAFT ("Bozza") non esiste più.
-- Le bozze esistenti diventano documenti da saldare. Swap transaction-safe
-- (ALTER TYPE ... ADD/DROP VALUE non è eseguibile in transazione su Postgres).
UPDATE "Invoice" SET status = 'ISSUED' WHERE status = 'DRAFT';

ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "InvoiceStatus_new" AS ENUM ('ISSUED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED');

ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING "status"::text::"InvoiceStatus_new";

ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";

ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";

DROP TYPE "InvoiceStatus_old";

ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'ISSUED'::"InvoiceStatus";
