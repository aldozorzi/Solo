-- Aggiunge PRESTAZIONE_OCCASIONALE all'enum TaxRegime.
-- Swap transaction-safe (ALTER TYPE ... ADD VALUE non è eseguibile in transazione su Postgres).
-- Il DEFAULT sulla colonna va rimosso prima del cast e ripristinato dopo.
ALTER TABLE "User" ALTER COLUMN "taxRegime" DROP DEFAULT;

CREATE TYPE "TaxRegime_new" AS ENUM ('FORFETTARIO', 'ORDINARIO', 'PRESTAZIONE_OCCASIONALE');

ALTER TABLE "User" ALTER COLUMN "taxRegime" TYPE "TaxRegime_new" USING "taxRegime"::text::"TaxRegime_new";

ALTER TYPE "TaxRegime" RENAME TO "TaxRegime_old";

ALTER TYPE "TaxRegime_new" RENAME TO "TaxRegime";

DROP TYPE "TaxRegime_old";

ALTER TABLE "User" ALTER COLUMN "taxRegime" SET DEFAULT 'FORFETTARIO'::"TaxRegime";
