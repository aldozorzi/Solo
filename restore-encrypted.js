const { Client } = require('/tmp/opencode/pw/node_modules/pg');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const argon2 = require('/workspace/solo/node_modules/argon2');

// ============================================================
// CONSTANTS - match the app's crypto.ts
// ============================================================
const AES_ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function pack(ciphertext, iv, authTag) {
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

function encryptField(plaintext, dek) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(AES_ALGO, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: pack(ciphertext, iv, authTag),
    iv: iv.toString('base64'),
  };
}

async function deriveKeyFromPassword(password, salt) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
    salt,
    raw: true,
  });
}

function wrapKey(key, wrappingKey) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(AES_ALGO, wrappingKey, iv);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return pack(ciphertext, iv, authTag);
}

// ============================================================
// MASTER KEY
// ============================================================
const MASTER_KEY_B64 = process.env.MASTER_KEY || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const MASTER_KEY = Buffer.from(MASTER_KEY_B64, 'base64');
if (MASTER_KEY.length !== 32) {
  throw new Error('MASTER_KEY must be 32 bytes');
}

// ============================================================
// LOAD BACKUP
// ============================================================
const backupPath = '/workspace/solo/backups/solo-20261008-121526.sql.gz';
const sql = zlib.gunzipSync(fs.readFileSync(backupPath)).toString('utf8');

// Parse backup SQL - extract COPY data
function parseBackup(sql) {
  const lines = sql.split('\n');
  const data = {
    User: [],
    Client: [],
    Invoice: [],
    InvoiceItem: [],
    Payment: [],
  };
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('COPY public."')) {
      const match = line.match(/COPY public\."(\w+)" \((.*?)\) FROM stdin;/);
      if (match) {
        const table = match[1];
        const cols = match[2].split(',').map(c => c.trim().replace(/"/g, ''));
        i++;
        const rows = [];
        while (i < lines.length && lines[i] !== '\\.') {
          const parts = lines[i].split('\t');
          const row = {};
          cols.forEach((col, idx) => {
            let val = parts[idx];
            if (val === '\\N') val = null;
            else if (val !== undefined) {
              val = val.replace(/\\\\/g, '\\')
                       .replace(/\\t/g, '\t')
                       .replace(/\\n/g, '\n')
                       .replace(/\\r/g, '\r');
            }
            row[col] = val;
          });
          rows.push(row);
          i++;
        }
        data[table] = rows;
      }
    }
    i++;
  }
  return data;
}

const backupData = parseBackup(sql);
console.log('Parsed backup:', Object.fromEntries(Object.entries(backupData).map(([k,v])=>[k,v.length])));

// Parse PostgreSQL array literal {a,b,c} -> [a,b,c]
function parsePgArray(str) {
  if (!str || str === '{}') return [];
  const inner = str.slice(1, -1);
  if (!inner) return [];
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && (i === 0 || inner[i-1] !== '\\')) {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}

// ============================================================
// CONNECT TO NEW DB (5437)
// ============================================================
const c = new Client({ host: '127.0.0.1', port: 5437, user: 'ldazrz', database: 'solo' });

async function restore() {
  await c.connect();
  console.log('Connected to clean DB on 5437');
  
  // ------------------------------------------------------------------
  // 1. INSERT USERS (plain fields, no encryption on User table)
  // ------------------------------------------------------------------
  console.log('\n--- Restoring Users ---');
  for (const u of backupData.User) {
    const totpBackupCodes = parsePgArray(u.totpBackupCodes);
    await c.query(`
      INSERT INTO "User" (id, email, name, "passwordHash", role, "businessName", "vatNumber", "taxCode", 
        address, city, "zipCode", country, province, "taxRegime", "senderType", 
        "sessionVersion", "totpSecret", "totpEnabled", "totpBackupCodes",
        "zeroKnowledgeEnabled", "zeroKnowledgeActivatedAt", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      ON CONFLICT (id) DO NOTHING
    `, [
      u.id, u.email, u.name, u.passwordHash, u.role, u.businessName, u.vatNumber, u.taxCode,
      u.address, u.city, u.zipCode, u.country, u.province, u.taxRegime, u.senderType,
      parseInt(u.sessionVersion || '0'), u.totpSecret, u.totpEnabled === 'true' || u.totpEnabled === true, 
      totpBackupCodes,
      false, null, // zeroKnowledgeEnabled, zeroKnowledgeActivatedAt
      u.createdAt, u.updatedAt
    ]);
    console.log(`  User: ${u.email}`);
  }
  
  // ------------------------------------------------------------------
  // 2. CREATE USERKEYS with a known DEK for each user
  // ------------------------------------------------------------------
  console.log('\n--- Creating UserKeys ---');
  const userDeks = new Map(); // userId -> DEK
  
  for (const u of backupData.User) {
    const dek = crypto.randomBytes(32);
    userDeks.set(u.id, dek);
    
    const wSys = wrapKey(dek, MASTER_KEY);
    
    const argon2Salt = crypto.randomBytes(16);
    const pwdKey = await deriveKeyFromPassword('test123', argon2Salt);
    const wPwd = wrapKey(dek, pwdKey);
    
    await c.query(`
      INSERT INTO "UserKey" (id, "userId", "argon2Salt", "wPwd", "wSys", version, "zeroKnowledgeMode", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,1,false,NOW(),NOW())
      ON CONFLICT ("userId") DO NOTHING
    `, [
      crypto.randomUUID(), u.id, argon2Salt.toString('base64'), wPwd, wSys
    ]);
    console.log(`  UserKey for ${u.email}: wPwd + wSys created`);
  }
  
  // ------------------------------------------------------------------
  // 3. RESTORE CLIENTS - encrypt sensitive fields
  // ------------------------------------------------------------------
  console.log('\n--- Restoring Clients ---');
  for (const cl of backupData.Client) {
    const dek = userDeks.get(cl.userId);
    if (!dek) { console.log(`  SKIP: no DEK for user ${cl.userId}`); continue; }
    
    const name = encryptField(cl.name || '', dek);
    const vatNumber = cl.vatNumber ? encryptField(cl.vatNumber, dek) : {ciphertext: null, iv: null};
    const taxCode = cl.taxCode ? encryptField(cl.taxCode, dek) : {ciphertext: null, iv: null};
    const sdiCode = cl.sdiCode ? encryptField(cl.sdiCode, dek) : {ciphertext: null, iv: null};
    const address = cl.address ? encryptField(cl.address, dek) : {ciphertext: null, iv: null};
    const city = cl.city ? encryptField(cl.city, dek) : {ciphertext: null, iv: null};
    const zipCode = cl.zipCode ? encryptField(cl.zipCode, dek) : {ciphertext: null, iv: null};
    const country = cl.country ? encryptField(cl.country, dek) : {ciphertext: null, iv: null};
    
    await c.query(`
      INSERT INTO "Client" (id, "userId", "nameEnc", "nameIv", type, "vatNumberEnc", "vatNumberIv",
        "taxCodeEnc", "taxCodeIv", "sdiCodeEnc", "sdiCodeIv", "addressEnc", "addressIv",
        "cityEnc", "cityIv", "zipCodeEnc", "zipCodeIv", "countryEnc", "countryIv",
        "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT (id) DO NOTHING
    `, [
      cl.id, cl.userId, name.ciphertext, name.iv, cl.type,
      vatNumber.ciphertext, vatNumber.iv,
      taxCode.ciphertext, taxCode.iv,
      sdiCode.ciphertext, sdiCode.iv,
      address.ciphertext, address.iv,
      city.ciphertext, city.iv,
      zipCode.ciphertext, zipCode.iv,
      country.ciphertext, country.iv,
      cl.createdAt, cl.updatedAt
    ]);
    console.log(`  Client: ${cl.name} (${cl.id})`);
  }
  
  // ------------------------------------------------------------------
  // 4. RESTORE INVOICES - encrypt sensitive fields
  // ------------------------------------------------------------------
  console.log('\n--- Restoring Invoices ---');
  for (const inv of backupData.Invoice) {
    const dek = userDeks.get(inv.userId);
    if (!dek) { console.log(`  SKIP: no DEK for user ${inv.userId}`); continue; }
    
    const date = encryptField(inv.date || new Date().toISOString(), dek);
    const subtotalAmount = encryptField(inv.subtotalAmount || '0', dek);
    const stampDutyAmount = encryptField(inv.stampDutyAmount || '0', dek);
    const totalAmount = encryptField(inv.totalAmount || '0', dek);
    const notes = inv.notes ? encryptField(inv.notes, dek) : {ciphertext: null, iv: null};
    
    await c.query(`
      INSERT INTO "Invoice" (id, "userId", number, year, "dateEnc", "dateIv", "clientId",
        "subtotalAmountEnc", "subtotalAmountIv", "stampDutyAmountEnc", "stampDutyAmountIv",
        "totalAmountEnc", "totalAmountIv", "notesEnc", "notesIv", status, "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO NOTHING
    `, [
      inv.id, inv.userId, parseInt(inv.number), parseInt(inv.year), date.ciphertext, date.iv, inv.clientId,
      subtotalAmount.ciphertext, subtotalAmount.iv,
      stampDutyAmount.ciphertext, stampDutyAmount.iv,
      totalAmount.ciphertext, totalAmount.iv,
      notes.ciphertext, notes.iv,
      inv.status, inv.createdAt, inv.updatedAt
    ]);
    console.log(`  Invoice: ${inv.number}/${inv.year} (${inv.id})`);
  }
  
  // ------------------------------------------------------------------
  // 5. RESTORE INVOICE ITEMS
  // ------------------------------------------------------------------
  console.log('\n--- Restoring InvoiceItems ---');
  for (const item of backupData.InvoiceItem) {
    const inv = backupData.Invoice.find(i => i.id === item.invoiceId);
    if (!inv) { console.log(`  SKIP: invoice not found ${item.invoiceId}`); continue; }
    const dek = userDeks.get(inv.userId);
    if (!dek) { console.log(`  SKIP: no DEK for user ${inv.userId}`); continue; }
    
    const description = encryptField(item.description || '', dek);
    const amount = encryptField(item.amount || '0', dek);
    
    await c.query(`
      INSERT INTO "InvoiceItem" (id, "invoiceId", "descriptionEnc", "descriptionIv", "amountEnc", "amountIv")
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO NOTHING
    `, [
      item.id, item.invoiceId, description.ciphertext, description.iv, amount.ciphertext, amount.iv
    ]);
    console.log(`  InvoiceItem: ${item.description} (${item.id})`);
  }
  
  // ------------------------------------------------------------------
  // 6. RESTORE PAYMENTS - encrypt sensitive fields
  // ------------------------------------------------------------------
  console.log('\n--- Restoring Payments ---');
  for (const p of backupData.Payment) {
    const dek = userDeks.get(p.userId);
    if (!dek) { console.log(`  SKIP: no DEK for user ${p.userId}`); continue; }
    
    const amount = encryptField(p.amount || '0', dek);
    const currency = encryptField(p.currency || 'EUR', dek);
    const originalAmount = p.originalAmount ? encryptField(p.originalAmount, dek) : {ciphertext: null, iv: null};
    const originalCurrency = p.originalCurrency ? encryptField(p.originalCurrency, dek) : {ciphertext: null, iv: null};
    const paidAt = encryptField(p.paidAt || new Date().toISOString(), dek);
    const description = encryptField(p.description || '', dek);
    
    await c.query(`
      INSERT INTO "Payment" (id, "userId", "clientId", "amountEnc", "amountIv", "currencyEnc", "currencyIv",
        "originalAmountEnc", "originalAmountIv", "originalCurrencyEnc", "originalCurrencyIv",
        "paidAtEnc", "paidAtIv", "descriptionEnc", "descriptionIv", "invoiceId", "createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO NOTHING
    `, [
      p.id, p.userId, p.clientId, amount.ciphertext, amount.iv, currency.ciphertext, currency.iv,
      originalAmount.ciphertext, originalAmount.iv,
      originalCurrency.ciphertext, originalCurrency.iv,
      paidAt.ciphertext, paidAt.iv,
      description.ciphertext, description.iv,
      p.invoiceId, p.createdAt
    ]);
    console.log(`  Payment: ${p.amount} ${p.currency} (${p.id})`);
  }
  
  console.log('\n=== RESTORE COMPLETE ===');
  await c.end();
}

restore().catch(e => { console.error(e); process.exit(1); });
