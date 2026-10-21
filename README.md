# Solo — Gestionale incassi e fatturazione

Gestionale self-hosted, multi-utente, per attività italiane con clienti in **Italia, UE ed Extra-UE**.
Supporta tre regimi fiscali: **Forfettario**, **Ordinario** e **Prestazione occasionale**.

Il flusso di lavoro parte dagli incassi: i pagamenti vengono registrati man mano, raggruppati
per cliente e trasformati in fatture (XML FatturaPA per lo SdI + PDF) oppure in ricevute PDF
per le prestazioni occasionali.

## Funzionalità

- **Dashboard** — incassi mensili/annui, incassi pendenti, documenti aperti, azioni rapide.
- **Incassi** — registrazione pagamenti anche parziali, collegamento a un documento, descrizione
  libera, modifica/eliminazione con ricalcolo automatico dello stato della fattura.
- **Valute estere** — per i clienti Extra-UE l'importo può essere inserito in valuta originale:
  il controvalore in EUR è calcolato con il cambio giornaliero della **Banca d'Italia**
  (con arretramento automatico sui giorni precedenti in caso di weekend/festivi).
- **Fatture e ricevute** — creazione da incassi pendenti e/o righe manuali, numerazione
  progressiva per anno, PDF, XML FatturaPA v1.2 (FPR12) e stato derivato dagli incassi
  (`Da saldare`, `Parzialmente saldata`, `Saldata`, `Annullata`).
- **Clienti** — anagrafica Italia / UE / Extra-UE con default SDI e CAP per tipo cliente.
- **Utenti** — primo utente ADMIN, successivi invitati via email; gestione utenti, reset
  password/2FA via email e revoca delle sessioni attive.
- **Impostazioni** — dati del cedente/prestatore con validazione di P.IVA e codice fiscale,
  regime fiscale e tipo soggetto; attivazione 2FA e modalità Zero-Knowledge.
- **Sicurezza** — cifratura application-level dei dati sensibili, sessioni JWT con
  `sessionVersion`, 2FA TOTP, rate limiting e audit log.

## Regimi fiscali

Il regime è configurato **per utente** (Impostazioni) e si applica a tutti i documenti emessi.
Le regole sono implementate in `src/lib/tax.ts`:

| Regime | Cliente | IVA | Natura | Bollo | Ritenuta |
|---|---|---|---|---|---|
| Forfettario | Italia / UE / Extra-UE | 0% | `N2.2` | 2,00 € se imponibile > 77,47 € | no |
| Ordinario | Italia | 22% | — | no | 20% solo se `LIBERO_PROFESSIONISTA` |
| Ordinario | UE | 0% | `N2.1` | no | no |
| Ordinario | Extra-UE | 0% | `N2.2` | 2,00 € se imponibile > 77,47 € | no |
| Prestazione occasionale | Italia con P.IVA | fuori campo IVA | — | non gestito | 20% |
| Prestazione occasionale | Italia senza P.IVA / UE / Extra-UE | fuori campo IVA | — | non gestito | no |

Note:

- **Forfettario** (`RF19`): nessuna IVA per nessun cliente; bollo virtuale tracciato se
  l'imponibile supera 77,47 €. Dicitura e riferimento normativo cambiano per Italia, UE
  (art. 7-ter D.P.R. 633/72) ed Extra-UE.
- **Ordinario** (`RF01`): IVA 22% verso l'Italia; reverse charge intra-UE (`N2.1`);
  Extra-UE non soggette (`N2.2`).
- **Prestazione occasionale** (art. 67, lett. l, D.P.R. 917/1986): sempre fuori campo IVA,
  **mai XML/SdI**, solo ricevuta PDF. La ritenuta del 20% si applica solo verso clienti
  italiani con P.IVA (presunto sostituto d'imposta) e non verso soggetti esteri.
- **Bollo virtuale**: tag XML `<DatiBollo>` e dicitura PDF
  "Imposta di bollo da € 2,00 assolta in modo virtuale ai sensi del D.M. 17/06/2014".
- **Default clienti**: Italia `SDI 0000000`; UE/Extra-UE `XXXXXXX` e CAP `00000`.

## Architettura: incasso → documento

1. **Registrazione incassi** — ogni pagamento viene registrato quando viene incassato.
2. **Accorpamento flessibile** — gli incassi pendenti vengono raggruppati per cliente.
3. **Generazione documento**:
   - **XML FatturaPA v1.2** validato per il portale *Fatture e Corrispettivi* (SdI),
     solo per Forfettario e Ordinario;
   - **PDF fattura** (Forfettario/Ordinario) o **PDF ricevuta** (Prestazione occasionale)
     per archivio e cortesia.

Lo stato del documento non è manuale: viene ricalcolato dagli incassi collegati
(`src/lib/invoice-status.ts`). L'export XML/PDF non modifica lo stato.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + React 19
- **Language**: TypeScript 5
- **ORM / DB**: Prisma 5 + PostgreSQL (Neon in produzione, Docker in locale)
- **Auth**: NextAuth (JWT) + credenziali, 2FA TOTP, recupero via email
- **UI**: Tailwind CSS 4 + Shadcn/ui (Radix UI), tema chiaro/scuro
- **Form**: React Hook Form + Zod
- **Documenti**: `@react-pdf/renderer` (PDF), `xmlbuilder2` (XML FatturaPA)
- **Crittografia**: Argon2id + AES-256-GCM (doppio involucro delle DEK)
- **Email**: Resend
- **Test**: Jest + ts-jest
- **Deploy**: Vercel

## Sviluppo locale

Requisiti: Node.js >= 20 e un PostgreSQL raggiungibile.

```bash
# 1. Dipendenze
npm install

# 2. Variabili d'ambiente
cp .env.example .env
# Modifica .env con i tuoi valori

# 3. PostgreSQL locale (opzionale: usa Docker Compose)
docker compose -f docker-compose-postgres.yml up -d

# 4. Schema e client Prisma
npx prisma generate
npx prisma migrate deploy     # oppure: npx prisma migrate dev

# 5. Server di sviluppo
npm run dev
```

Apri `http://localhost:3000`. Con database vuoto la pagina `/register` crea il **primo
utente come ADMIN**; gli utenti successivi si creano da **Utenti** e ricevono un invito
email per impostare la password (serve Resend configurato).

## Variabili d'Ambiente

| Variabile | Descrizione | Obbligatoria |
|---|---|---|
| `DATABASE_URL` | Connection string PostgreSQL runtime (produzione: Neon **pooled** con `?pgbouncer=true`) | Sì |
| `DIRECT_URL` | Connessione **diretta** usata dalle migration Prisma; in locale può coincidere con `DATABASE_URL` | Sì |
| `NEXTAUTH_SECRET` | Segreto firma JWT e derivazione chiavi (min. 32 caratteri casuali) | Sì |
| `NEXTAUTH_URL` | URL pubblico https. In locale va **lasciata non impostata** | Produzione |
| `AUTH_TRUST_HOST` | `true` solo in sviluppo locale (origin dall'Host per IP LAN variabili) | Locale |
| `MASTER_KEY` | Master Key di sistema (base64, 32 byte): avvolge le DEK utente (W_sys). Genera con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | Sì |
| `RESEND_API_KEY` | Chiave API Resend per inviti, reset password e reset 2FA | Sì in produzione |
| `MAIL_FROM` | Mittente verificato, es. `Solo <noreply@example.com>` | Con Resend |
| `APP_URL` | URL canonico usato nei link delle email (mai dall'Host: anti poisoning) | Con Resend |
| `AUDIT_WEBHOOK_URL` | (Opzionale) endpoint che riceve gli alert brute-force | No |
| `AUDIT_LOG_PATH` | (Opzionale) percorso del file audit JSONL | No |

Attenzione: se `MASTER_KEY` viene persa, i dati cifrati degli utenti non-ZK sono
irrecuperabili. La rotazione richiede il re-wrap di tutte le `UserKey` esistenti.

## Test

```bash
npm run test:xml        # matrice XML: 36 combinazioni, solo verifica testuale
npm run test:xml:files  # come sopra + 36 file XML in test-output/
npm run test:security   # gate anti-escalation (richiede DB scratch + app avviata)
```

- La **matrice XML** copre 3 tipi cedente × 2 regimi (Forfettario/Ordinario) × 3 clienti
  (Italia/Germania/USA) × 1 o 2 pagamenti. Crea un database PostgreSQL temporaneo e non
  tocca i dati reali.
- La suite **ricevuta** (`tests/integration/ricevuta.test.ts`) verifica la logica della
  prestazione occasionale e il contenuto della ricevuta PDF, senza DB.
- `npm run test:security` esegue test black-box via HTTP e **abortisce se il DB contiene
  utenti**: va lanciata solo contro un database scratch, con l'app in esecuzione.

Dettagli e procedura completa in [`tests/README.md`](tests/README.md).

## Sicurezza

Il modello completo, le decisioni e le procedure operative sono in
[`docs/SECURITY.md`](docs/SECURITY.md). In sintesi:

- Password **bcrypt cost 12**, min. 12 caratteri; errori e tempi uniformi; rate limiting.
- **2FA TOTP** opzionale con backup code monouso; `sessionVersion` invalida le sessioni
  al cambio password/reset 2FA.
- **Cifratura application-level**: campi sensibili di clienti, incassi e fatture cifrati
  con DEK per utente (AES-256-GCM), avvolta con password (Argon2id) e con `MASTER_KEY`.
- **Zero-Knowledge mode** opzionale: la `MASTER_KEY` non può sbloccare i dati; il recupero
  richiede il secret dell'utente.
- **Ruoli**: il primo utente è ADMIN (write-once); gli endpoint `/api/users*` sono protetti
  sia nel proxy sia negli handler. L'admin non imposta mai password altrui.
- **Audit log** JSONL con rotazione, alert brute-force e webhook opzionale.
- Header di sicurezza e CSP attiva in produzione.

Backup e restore:

```bash
./scripts/backup-db.sh                      # dump gzip in backups/ (ultimi 14)
CONFIRM_RESTORE=I-UNDERSTAND ./scripts/restore-db.sh backups/solo-YYYYMMDD-HHMMSS.sql.gz
```

## Deploy su Vercel

1. Crea il progetto su NeonDB **nella stessa region delle function Vercel**
   (`vercel.json` usa `iad1`).
2. Collega il repository GitHub a Vercel (o usa l'integrazione Neon↔Vercel).
3. Configura le variabili in Vercel:
   - `DATABASE_URL` = connection string **pooled** di Neon con `?pgbouncer=true`;
   - `DIRECT_URL` = connection string **diretta** (solo migration);
   - `NEXTAUTH_SECRET`, `NEXTAUTH_URL=https://<tuo-dominio>`; **niente** `AUTH_TRUST_HOST`;
   - `MASTER_KEY` (diversa da quella locale);
   - `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`.
4. Pipeline (`vercel.json`): `prisma generate` → `prisma migrate deploy` → `next build`
   a ogni deploy. Mai `db push` / `--force-reset` su produzione.
5. Verifica post-deploy: header di sicurezza, login + 2FA, backup/PITR attivo su Neon,
   alert Dependabot abilitati.

## Struttura Progetto

```
src/
├── app/
│   ├── api/
│   │   ├── auth/          # NextAuth, forgot/reset password, reset 2FA, Zero-Knowledge
│   │   ├── clients/       # CRUD clienti
│   │   ├── exchange-rate/ # cambio giornaliero Banca d'Italia
│   │   ├── invoices/      # CRUD documenti + export XML/PDF
│   │   ├── login/         # login a due step (password + MFA), logout
│   │   ├── mfa/           # setup/verifica TOTP
│   │   ├── payments/      # CRUD incassi
│   │   ├── settings/      # dati cedente, regime fiscale, tipo soggetto
│   │   └── users/         # gestione utenti (ADMIN)
│   ├── clienti/ incassi/ fatture/ impostazioni/ utenti/
│   ├── login/ register/ reset-password/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx           # Dashboard
├── components/
│   ├── ui/                # Componenti Shadcn/ui
│   ├── Dashboard.tsx      # Vista a tab: incassi, documenti, clienti
│   ├── HomeDashboard.tsx  # Riepiloghi e grafico ricavi
│   ├── ClientForm.tsx     # Form cliente
│   ├── PaymentForm.tsx    # Form incasso (+ cambio valuta)
│   ├── InvoiceForm.tsx    # Creazione fattura/ricevuta
│   ├── InvoiceEditForm.tsx
│   ├── SettingsForm.tsx   # Dati cedente + regime
│   ├── MfaSettings.tsx
│   ├── ZeroKnowledgeSettings.tsx
│   └── UserManagement.tsx
├── lib/
│   ├── auth.ts            # NextAuth e hashing password
│   ├── crypto.ts          # DEK, Argon2id, AES-256-GCM
│   ├── data-encryption.ts # cifratura/decifratura campi sensibili
│   ├── tax.ts             # calcoli fiscali per i tre regimi
│   ├── invoice-status.ts  # stato derivato dagli incassi
│   ├── xml-generator.ts   # XML FatturaPA v1.2
│   ├── pdf-generator.tsx  # PDF fattura e ricevuta
│   ├── ricevuta-content.ts
│   ├── fiscal-code.ts     # validazione P.IVA / codice fiscale
│   ├── audit.ts rate-limit.ts
│   └── ...
└── types/
    └── index.ts           # Type exports + costanti UI
```

## API Endpoints

Tutte le API (tranne auth e bootstrap) richiedono sessione e filtrano i dati per `userId`.

### Autenticazione
- `POST /api/login` — login a due step (password + codice TOTP se attivo)
- `DELETE /api/login` — logout e cancellazione cookie DEK
- `POST /api/mfa` — setup/verifica 2FA
- `POST /api/auth/forgot-password` — invio link di reset password
- `POST /api/auth/reset-password` — completamento reset password
- `POST /api/auth/reset-mfa` — reset 2FA via email
- `GET/POST /api/auth/[...nextauth]` — NextAuth (solo utenti senza 2FA)
- `POST /api/auth/zero-knowledge/{enable,disable,rotate-secret}` — gestione ZK
- `GET /api/auth/zero-knowledge/status` — stato ZK
- `POST /api/auth/zk-password-reset` — reset password in modalità ZK

### Clienti
- `GET /api/clients` — lista clienti
- `POST /api/clients` — crea cliente
- `GET /api/clients/[id]` — dettaglio cliente
- `PUT /api/clients/[id]` — aggiorna cliente
- `DELETE /api/clients/[id]` — elimina cliente (409 se ha movimenti)

### Incassi
- `GET /api/payments` — lista incassi (`?clientId=`, `?withoutInvoice=true`)
- `POST /api/payments` — registra incasso
- `PUT /api/payments/[id]` — aggiorna incasso
- `DELETE /api/payments/[id]` — elimina incasso

### Fatture e ricevute
- `GET /api/invoices` — lista documenti (`?clientId=`)
- `POST /api/invoices` — genera documento da incassi/righe
- `GET /api/invoices/[id]?format=xml|pdf|json` — dettaglio/export
- `PUT /api/invoices/[id]` — aggiorna documento
- `DELETE /api/invoices/[id]` — elimina documento (gli incassi tornano pendenti)

### Altro
- `GET /api/exchange-rate?date=&currency=&amount=` — cambio Banca d'Italia
- `GET/PUT /api/settings` — dati cedente e configurazione fiscale
- `GET/POST /api/users` — lista/crea utenti (ADMIN; POST libero solo per il bootstrap)
- `GET/PUT/DELETE /api/users/[id]` — dettaglio/modifica/eliminazione utente (ADMIN)
- `POST /api/users/[id]/revoke-sessions` — revoca tutte le sessioni dell'utente (ADMIN)

## Licenza

Proprietario — solo per uso interno.
