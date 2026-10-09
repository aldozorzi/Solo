# Solo - Gestionale Fatture Regime Forfettario

Sistema personalizzato di gestione incassi e fatturazione per attività in **Regime Forfettario**, ottimizzato per clienti prevalentemente esteri (Extra-UE / USA e UE) e italiani.

## Architettura: Incasso → Fatturazione

1. **Registrazione incassi** - Ogni pagamento viene registrato man mano che viene incassato
2. **Accorpamento flessibile** - Gli incassi pendenti vengono raggruppati per generare fatture cumulative
3. **Generazione automatica**:
   - **PDF di cortesia/archivio** per uso interno
   - **File XML FatturaPA v1.2** validato per il portale *Fatture e Corrispettivi* (SdI)

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **ORM**: Prisma ORM
- **Database**: NeonDB (PostgreSQL Serverless)
- **Deploy**: Vercel
- **UI**: Tailwind CSS + Shadcn/ui (Radix UI)
- **Forms**: React Hook Form + Zod
- **PDF**: @react-pdf/renderer

## Funzionalità Fiscali (Regime Forfettario)

### Clienti Extra-UE (USA, ecc.)
- Natura IVA: `N2.2` (Non soggette - art. 7-ter D.P.R. 633/72)
- Codice SDI: `XXXXXXX`
- CAP: `00000`

### Clienti UE
- Natura IVA: `N3.2` (Non imponibili - prestazioni intracomunitarie)
- Codice SDI: `XXXXXXX`
- CAP: `00000`

### Clienti Italia
- Natura IVA: `N2.2` (Regime Forfettario)
- Codice SDI: Codice a 7 cifre o PEC (default `0000000`)
- CAP: Standard italiano

### Imposta di Bollo Virtuale (2,00 €)
- Applicata automaticamente se imponibile > 77,47 €
- Tag XML: `<BolloVirtuale>SI</BolloVirtuale><ImportoBollo>2.00</ImportoBollo>`
- Dicitura PDF: "Imposta di bollo da € 2,00 assolta in modo virtuale ai sensi del D.M. 17/06/2014"

## Sviluppo Locale

```bash
# Installa dipendenze
npm install

# Configura variabili d'ambiente
cp .env.example .env.local
# Modifica .env.local con i tuoi valori

# Genera Prisma Client
npx prisma generate

# Push schema al database
npx prisma db push

# Avvia server di sviluppo
npm run dev
```

## Test matrice XML

La suite usa un database PostgreSQL temporaneo e non modifica i dati reali.
Dettagli completi in [`tests/README.md`](tests/README.md).

```bash
npm run test:xml        # solo verifica testuale, senza file
npm run test:xml:files  # verifica testuale più 36 XML in test-output/
```

## Variabili d'Ambiente

| Variabile | Descrizione | Obbligatoria |
|-----------|-------------|--------------|
| `DATABASE_URL` | Connection string PostgreSQL (locale: Docker; produzione: Neon **pooled**) | Sì |
| `DIRECT_URL` | Connessione **diretta** (senza pooler) usata solo da `prisma migrate deploy`. In locale = `DATABASE_URL` | Sì |
| `NEXTAUTH_SECRET` | Segreto firma JWT (min. 32 caratteri casuali) | Sì |
| `NEXTAUTH_URL` | Solo produzione: URL pubblico https. In locale va **lasciata non impostata** | Produzione |
| `AUTH_TRUST_HOST` | `true` in sviluppo locale (origin dall'Host per IP LAN variabili) | Locale |
| `AUDIT_WEBHOOK_URL` | (Opzionale) endpoint che riceve gli alert brute-force | No |
| `AUDIT_LOG_PATH` | (Opzionale) percorso file audit JSONL | No |
| `RESEND_API_KEY` | Chiave API Resend per le email di setup/reset | Sì |
| `MAIL_FROM` | Mittente verificato, es. `Solo <noreply@ldazrz.com>` | Sì |
| `APP_URL` | URL canonico usato nei link email (mai dall'Host: anti poisoning) | Sì |
| `MASTER_KEY` | Master Key di sistema (base64, 32 byte): avvolge le DEK utente (W_sys). Genera con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | Sì |

## Sicurezza

Dettagli, decisioni esplicite e procedure (backup/restore, rotazioni, incidenti):
[`docs/SECURITY.md`](docs/SECURITY.md).

```bash
./scripts/backup-db.sh                      # dump gzip in backups/ (ultimi 14)
CONFIRM_RESTORE=I-UNDERSTAND ./scripts/restore-db.sh backups/solo-YYYYMMDD-HHMMSS.sql.gz
```

## Deploy su Vercel

1. Crea il progetto su NeonDB **nella stessa region delle function Vercel**
   (oggi `vercel.json` dice `iad1`: o il DB sta lì vicino o si sposta la region).
2. Collega repository GitHub a Vercel (o installa l'integrazione Neon↔Vercel).
3. Variabili in Vercel Dashboard:
   - `DATABASE_URL` = connection string **pooled** di Neon **con flag PgBouncer**
     (`...?pgbouncer=true`): senza, Prisma su serverless fallisce a caso con
     errori "prepared statement".
   - `DIRECT_URL` = connection string **diretta** (solo per le migration).
   - `NEXTAUTH_SECRET` (segreto robusto, diverso da quello locale),
     `NEXTAUTH_URL=https://<tuo-dominio>`; **niente** `AUTH_TRUST_HOST`.
   - `MASTER_KEY` (base64 32 byte, diversa da quella locale: se la perdi,
     i dati cifrati sono irrecuperabili; se la ruoti, devi riavvolgere tutte le `UserKey`).
4. Pipeline: `prisma migrate deploy` (con `DIRECT_URL`) **prima** di `npm run build`,
   a ogni deploy. Mai `db push` / `--force-reset` su produzione.
5. Verifica post-deploy: header di sicurezza presenti, login + 2FA, PITR/retention
   backup attiva su Neon, alert Dependabot abilitati su GitHub.

## Struttura Progetto

```
src/
├── app/
│   ├── api/
│   │   ├── clients/       # CRUD clienti
│   │   ├── payments/      # CRUD incassi
│   │   └── invoices/      # CRUD fatture + export XML/PDF
│   ├── globals.css        # Stili globali + theme
│   ├── layout.tsx         # Root layout + ThemeProvider
│   └── page.tsx           # Dashboard principale
├── components/
│   ├── ui/                # Componenti Shadcn/ui
│   ├── Dashboard.tsx      # Vista principale con tabs
│   ├── ClientForm.tsx     # Form cliente (dialog/inline)
│   ├── PaymentForm.tsx    # Form incasso (dialog)
│   ├── InvoiceForm.tsx    # Form fattura (dialog)
│   └── ThemeProvider.tsx  # Wrapper next-themes
├── lib/
│   ├── prisma.ts          # Client Prisma singleton
│   ├── tax.ts             # Calcoli fiscali (helper puro)
│   ├── xml-generator.ts   # Generazione XML FatturaPA v1.2
│   ├── pdf-generator.tsx  # Generazione PDF (@react-pdf)
│   └── utils.ts           # Utility cn()
└── types/
    └── index.ts           # Type exports + costanti
```

## API Endpoints

### Clienti
- `GET /api/clients` - Lista clienti
- `POST /api/clients` - Crea cliente
- `GET /api/clients/[id]` - Dettaglio cliente
- `PUT /api/clients/[id]` - Aggiorna cliente
- `DELETE /api/clients/[id]` - Elimina cliente

### Incassi
- `GET /api/payments` - Lista incassi (?clientId=, ?withoutInvoice=true)
- `POST /api/payments` - Registra incasso

### Fatture
- `GET /api/invoices` - Lista fatture (?clientId=)
- `POST /api/invoices` - Genera fattura da incassi selezionati
- `GET /api/invoices/[id]?format=xml|pdf|json` - Dettaglio/export
- `DELETE /api/invoices/[id]` - Elimina fattura

## Licenza

Proprietario - Solo per uso interno.
