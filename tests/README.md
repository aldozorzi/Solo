# Suite matrice XML FatturaPA

La suite crea un **database PostgreSQL temporaneo**, semina 6 utenti, 18 anagrafiche cliente e poi genera e verifica **36 fatture XML**:

- 3 tipologie cedente: `LIBERO_PROFESSIONISTA`, `DITTA_INDIVIDUALE`, `SOCIETA`
- 2 regimi fiscali: `FORFETTARIO`, `ORDINARIO`
- 3 clienti: Italia, Germania, USA
- 2 casi pagamento per combinazione: 1 pagamento e 2 pagamenti

Il database reale non viene toccato: lo schema Prisma viene applicato soltanto al database temporaneo `solo_xml_*`, eliminato alla fine della suite.

## Modalità 1: solo verifica testuale, senza file

```bash
npm run test:xml
```

- Non scrive alcun XML.
- Stampa una riga `[PASS]` per ognuna delle 36 combinazioni, con totale, netto, ripartizione pagamenti, natura, bollo e ritenuta.
- Termina con il riepilogo Jest `36 passed`.

## Modalità 2: verifica più file XML

```bash
npm run test:xml:files
```

- Esegue gli stessi 36 controlli testuali.
- Scrive i file soltanto se tutti i controlli passano.
- Ricrea la cartella `test-output/` con nomi esplicativi, ad esempio:

```text
IT00743110157_26001-libero-professionista-forfettario-clienteIT-1pagamento.xml
IT00743110157_26001-libero-professionista-ordinario-clienteIT-2pagamenti.xml
```

Per usare un’altra cartella di output:

```bash
XML_MATRIX_OUT_DIR=/tmp/xml-matrix npm run test:xml:files
```

## Criteri verificati

Per ogni combinazione la suite controlla:

- totale documento e importo IVA;
- codice `Natura`, dicitura e riferimento normativo;
- presenza o assenza di `DatiBollo`;
- presenza o assenza di `DatiRitenuta` e del flag `<Ritenuta>SI</Ritenuta>`;
- causale completa, compreso il riferimento alla ritenuta quando dovuta;
- namespace `xmlns=""` su header e body;
- `Nazione` obbligatoria in entrambe le sedi;
- `CondizioniPagamento` (`TP02` per un pagamento, `TP01` per più pagamenti);
- un `DettaglioPagamento` per pagamento, con `MP05`, date attese e importi che quadrano al centesimo con il netto a pagare;
- divisione equa del netto tra le rate, senza copiare gli importi iniziali dei pagamenti.

## Matrice fiscale attesa

| Caso | Natura | Bollo | Ritenuta |
|---|---|---|---|
| Forfettario, tutti i clienti | `N2.2` | `2,00 €` se imponibile `> 77,47 €` | no |
| Ordinario, cliente Italia, libero professionista | IVA `22%`, senza natura | no | `20%` sull’imponibile |
| Ordinario, cliente Italia, altri soggetti | IVA `22%`, senza natura | no | no |
| Ordinario, cliente UE | `N2.1` | no | no |
| Ordinario, cliente Extra-UE | `N2.2` | `2,00 €` se imponibile `> 77,47 €` | no |

## Gate sicurezza pre-deploy (`test:security`)

`npm run test:security` esegue `tests/integration/security-access.test.ts`: 35 test
black-box via HTTP contro un'app in esecuzione (vertical/horizontal escalation,
uniformità errori login, rate limit, MFA end-to-end, rotazione sessioni, re-auth,
audit log, autorizzazione per-utente e flussi Zero-Knowledge a due fasi).
**Mai contro dati reali**: la suite abortisce se il DB contiene utenti.

Rituale completo (database e app temporanei, poi rimozione totale):

```bash
docker run -d --name solo-verify-sec -e POSTGRES_USER=solo \
  -e POSTGRES_PASSWORD=solo -e POSTGRES_DB=solo -p 5433:5432 postgres:16-alpine
export SCRATCH_URL="postgresql://solo:solo@localhost:5433/solo?schema=public"
# DIRECT_URL va impostata anche qui: lo schema Prisma la usa per le migrazioni/db push.
DATABASE_URL="$SCRATCH_URL" DIRECT_URL="$SCRATCH_URL" npx prisma db push --skip-generate
npm run build
DATABASE_URL="$SCRATCH_URL" DIRECT_URL="$SCRATCH_URL" RESEND_API_KEY= npx next start -p 3100 &
APP_BASE_URL=http://localhost:3100 TEST_DATABASE_URL="$SCRATCH_URL" npm run test:security
# teardown: kill server, docker rm -f solo-verify-sec, rimozione volume anonimo creato
```

Note:
- `RESEND_API_KEY=` vuoto di proposito: nessun invio reale durante i test; i flussi email
  falliscono in modo controllato (502 + rollback, verificato dalla suite). L'invio reale
  si prova a mano.
- La suite abortisce se il DB contiene già utenti: impossibile lanciarla per sbaglio
  contro dati reali (a patto di usare davvero un DB scratch come sopra).
