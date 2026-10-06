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

## Variabili d'Ambiente

| Variabile | Descrizione | Obbligatoria |
|-----------|-------------|--------------|
| `DATABASE_URL` | Connection string NeonDB/PostgreSQL | Sì |
| `SENDER_NAME` | Denominazione cedente/prestatore | Sì |
| `SENDER_VAT_NUMBER` | Partita IVA cedente | Sì |
| `SENDER_TAX_CODE` | Codice Fiscale cedente | Sì |
| `SENDER_ADDRESS` | Indirizzo sede | Sì |
| `SENDER_NUMBER` | Numero civico | Sì |
| `SENDER_ZIP` | CAP | Sì |
| `SENDER_CITY` | Comune | Sì |
| `SENDER_PROVINCE` | Provincia (sigla) | Sì |
| `SENDER_EMAIL` | Email (opzionale) | No |
| `SENDER_PHONE` | Telefono (opzionale) | No |

## Deploy su Vercel

1. Collega repository GitHub a Vercel
2. Configura variabili d'ambiente in Vercel Dashboard
3. Deploy automatico ad ogni push su `main`

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