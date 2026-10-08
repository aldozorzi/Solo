# Sicurezza — `solo`

Documento vivo delle decisioni di sicurezza: cosa è implementato, cosa è accettato
come rischio residuo e come operare (backup, rotazioni, incidenti).

## 1. Modello e perimetro

- L'app gira in due ambienti: **sviluppo su rete locale** e **produzione su Vercel** (deploy
  da GitHub, ambiente già pronto). Tutte le decisioni sotto valgono per entrambi; dove il
  comportamento differisce è scritto esplicitamente.
- Difesa in profondità: ogni lettura/scrittura su clienti, incassi e fatture è filtrata per
  `userId` di sessione; gli endpoint `/api/users*` richiedono ADMIN sia nel proxy che negli
  handler; la pagina `/utenti` ha redirect server-side per i non-admin.

## 2. Autenticazione

- Password **bcrypt cost 12**, minimo **12 caratteri** (registrazione, creazione e modifica).
- Messaggi di errore uniformi (mai distinzione utente/password) e **tempi uniformi**:
  confronto bcrypt sempre eseguito anche per utenti inesistenti (dummy hash cost 12).
- **Rate limiting** in-memory (per istanza — vedi limiti sotto): login 10 tentativi/10min per IP,
  callback NextAuth 20/10min, registrazione 5/ora. Superato il limite: `429` + `Retry-After`.
- **2FA TOTP** opzionale per account (RFC 6238, SHA-1, 30s, 6 cifre, finestra ±1) + 8 backup code
  monouso (hash bcrypt, mostrati una sola volta). I segreti sono cifrati AES-256-GCM con chiave
  derivata da `NEXTAUTH_SECRET`. Il login legacy `[...nextauth]` rifiuta gli account con 2FA:
  l'unico percorso è `/api/login` a due step (JSON per React, redirect per form nativo).
- **Step-up authentication**: eliminare un utente richiede la password corrente del
  richiedente. Password e 2FA altrui non sono mai impostabili dall'admin (vedi recovery).
- **Recovery via email (unico metodo)**: link monouso con token SHA-256 (solo hash nel DB),
  scadenza 24h (setup) / 15min (reset), single-use atomico, rate limiting stretto e risposta
  sempre uniforme (nessun oracolo esistenza-email). Setup account, reset password e reset 2FA
  passano tutti da qui; a completamento: bump `sessionVersion`, invalidazione token pendenti,
  email informativa all'utente. L'admin non conosce mai credenziali altrui: crea account
  bloccati e invia solo inviti.
- **Rotazione sessioni**: ogni utente ha `sessionVersion`; cambio password e reset 2FA la
  incrementano e invalidano tutti i JWT precedenti. I token emessi prima di questa modifica
  (senza versione) richiedono un nuovo login al primo accesso dopo il deploy.
- Il ruolo è **write-once**: primo utente = ADMIN, gli altri sempre USER, nessuna API/UI
  può crearlo o modificarlo. Impossibile restare senza admin via app.

## 3. Autorizzazione

- Ownership orizzontale verificata su ogni endpoint (lettura e scrittura).
- `invoiceId` nel POST pagamenti validato con ownership; incassi collegabili a una sola fattura
  (eccezione: quelli già della fattura in modifica); POST fatture allineato al PUT sul vincolo
  stesso-cliente.
- Cancellazioni: fattura → incassi preservati (`SET NULL`, tornano pendenti); cliente con
  movimenti → `RESTRICT` con `409` esplicito (niente cascade silenziose).

## 4. Audit log e alerting

- Eventi (`login_ok`, `login_ko`, `mfa_challenge`, `user.created/updated/deleted`,
  `user.mfa_enabled/disabled/reset`, `settings.updated`, `invoice.created/exported/deleted`)
  in JSONL su `logs/` (locale) con rotazione (2MB × 5 file) + mirror in console (Docker/Vercel logs).
- Su Vercel il filesystem è effimero: impostare `AUDIT_WEBHOOK_URL` per la copia durevole,
  oppure leggere i log drains. Percorso custom via `AUDIT_LOG_PATH`.
- Alert brute-force: ≥5 login falliti / 10 min dallo stesso IP → evento
  `auth.alert_bruteforce` + webhook se configurato.
- Nessun dato sensibile nei log: mai password, codici TOTP o segreti (solo email, id, IP).

## 5. Backup e restore

- Script: `scripts/backup-db.sh` (dump gzip con rotazione, default ultimi 14) e
  `scripts/restore-db.sh` (richiede `CONFIRM_RESTORE=I-UNDERSTAND`, rifiuta target
  `*prod*` senza `ALLOW_PROD_RESTORE=1`).
- Pianificare `backup-db.sh` via cron/systemd sul host Docker; **provare il restore**
  periodicamente su database scratch prima di fidarsi.
- Mai `prisma db push --force-reset` fuori dall'ambiente di sviluppo locale.

## 6. Headers e configurazione

- Produzione: CSP attiva (solo prod; in dev servirebbe `unsafe-eval` per le sourcemap),
  `nosniff`, `DENY` anti-framing, `no-referrer`, `Permissions-Policy` restrittiva, HSTS.
  Rimosso il CORS wildcard sulle API (app same-origin).
- Deploy: impostare `NEXTAUTH_URL=https://...` esplicito; `AUTH_TRUST_HOST=true` serve
  **solo** per il dev su IP LAN. Mai esporre la 5432 fuori dal PC in locale.
- Build resiliente: `/login` e `/register` sono `force-dynamic`, la build non richiede
  più il DB raggiungibile.

## 7. Rischi residui accettati (con contromisure per ambiente)

- Traffico in chiaro: solo in sviluppo LAN. In produzione Vercel forza HTTPS e sono attivi
  HSTS, cookie `__Secure-` e CSP (solo prod). Mai esporre servizi HTTP in chiaro fuori dal PC.
- JWT stateless: nessun elenco revoche oltre `sessionVersion`; logout = cancellazione cookie.
  Cambio password e reset 2FA invalidano comunque tutte le sessioni via `sessionVersion`.
- Rate limiting in-memory: su Vercel serverless il limite vale **per istanza** (più istanze =
  più tentativi complessivi). Accettato per ora; se l'app cresce, passare a contatore su
  Redis/Upstash.
- Nessuna 2FA obbligatoria di default (è opt-in per account); niente controllo breach password
  (k-anonymity HIBP) e niente WAF: rivalutare se l'utenza cresce oltre il singolo studio.
- Race sulla creazione del primo admin (due POST simultanee a DB vuoto): trascurabile.
- Supply chain: `npm audit` non è un gate di CI; abilita gli alert Dependabot su GitHub
  (file `.github/dependabot.yml` già presente). `postinstall` esegue `prisma skills sync`
  (pacchetto ufficiale).

## 8. Verifica manuale consigliata (serve DB attivo)

- Login errato ripetuto: messaggi/tempi uniformi; dopo 10 tentativi/10min arriva `429`.
- Impostazioni → attiva 2FA: segreto + QR-link, conferma con codice, backup code mostrati una volta.
- Logout/login con codice TOTP e con backup code (il backup usato non funziona più la seconda volta).
- Cambio password da Gestione Utenti (richiede la tua password): le sessioni precedenti smettono di funzionare.
- Reset 2FA da Gestione Utenti (richiede la tua password).
- Restore: solo su database scratch, mai su quello reale senza backup appena fatto.

## 9. In caso di incidente

1. Cambiare `NEXTAUTH_SECRET` (invalida JWT **e** segreti TOTP: gli utenti rientrano con
   password + backup code e riattivano la 2FA).
2. Incrementare `sessionVersion` degli utenti coinvolti (o cambio password, che lo fa da sé).
3. Controllare `auth.alert_bruteforce` nei log; ruotare eventuali credenziali DB esposte.
