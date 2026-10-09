/**
 * Suite anti escalation (verticale + orizzontale) da rilanciare prima di ogni deploy.
 *
 * Come si usa (mai contro dati reali):
 *   1. Postgres scratch su altra porta + `prisma db push`
 *   2. `npm run build` e avvio app su porta di test con DATABASE_URL scratch
 *      (e SENZA RESEND_API_KEY, così nessun invio reale parte mai)
 *   3. APP_BASE_URL=http://localhost:3100 npm run test:security
 *
 * La suite RIFIUTA di partire se il DB contiene già utenti (guard anti-dati-reali).
 * Dettagli completi in tests/README.md.
 */
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";
import { totpAt } from "@/lib/totp";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const AUDIT_LOG = path.join(process.cwd(), "logs", "audit.log");

jest.setTimeout(30000);

const BASE = process.env.APP_BASE_URL || "http://localhost:3100";
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error("TEST_DATABASE_URL non impostata: puntare a un database scratch vuoto");
}

function readDotEnv(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const envPath = path.join(process.cwd(), ".env");
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    if (t.slice(0, i).trim() === name) {
      return t.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
  throw new Error(`${name} non trovato`);
}

const NEXTAUTH_SECRET = readDotEnv("NEXTAUTH_SECRET");

const prisma = new PrismaClient({
  datasources: { db: { url: TEST_DB_URL } },
} as never) as PrismaClient;

// --- minimal cookie jar ---
class Jar {
  private cookies = new Map<string, string>();
  ingest(res: Response) {
    const setCookies: string[] =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [];
    for (const c of setCookies) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

let ipSeq = 0;
const freshIp = () => `10.9.9.${++ipSeq}`;

async function api(
  method: string,
  p: string,
  opts: { jar?: Jar; body?: unknown; ip?: string; json?: boolean } = {}
): Promise<{ status: number; headers: Headers; text: string; json: unknown }> {
  const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? freshIp() };
  let body: string | URLSearchParams | undefined;
  if (opts.body !== undefined) {
    if (opts.json === false) {
      // Modalità nativa (form HTML): urlencoded, niente header Accept: application/json.
      body = new URLSearchParams(
        Object.fromEntries(Object.entries(opts.body as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      );
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }
  if (opts.json !== false) headers["Accept"] = "application/json";
  if (opts.jar) {
    const h = opts.jar.header();
    if (h) headers["Cookie"] = h;
  }
  const res = await fetch(`${BASE}${p}`, { method, headers, body, redirect: "manual" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON (redirect HTML vuoto)
  }
  if (opts.jar) opts.jar.ingest(res);
  return { status: res.status, headers: res.headers, text, json };
}

async function loginJson(email: string, password: string, ip?: string): Promise<{ jar: Jar; body: unknown; status: number }> {
  const jar = new Jar();
  const r = await api("POST", "/api/login", { jar, ip, body: { email, password, callbackUrl: "/" } });
  return { jar, body: r.json, status: r.status };
}

const PASSWORD = "Password123456";
let PASSWORD_HASH = "";

async function mkUser(
  email: string,
  role: "ADMIN" | "USER" = "USER",
  taxRegime: "FORFETTARIO" | "ORDINARIO" | "PRESTAZIONE_OCCASIONALE" = "FORFETTARIO"
) {
  // Stessa password di login (PASSWORD): W_pwd valido, sbloccabile con password.
  const { generateUserKey } = await import("@/lib/crypto");
  const { wPwd, wSys, argon2Salt } = await generateUserKey(PASSWORD);
  return prisma.user.create({
    data: {
      userKey: {
        create: {
          argon2Salt: argon2Salt.toString("base64"),
          wPwd,
          wSys,
        },
      },
      email,
      name: email,
      passwordHash: PASSWORD_HASH,
      role: role as never,
      businessName: "Test",
      vatNumber: "00743110157",
      taxCode: "ZRZLDA82M09D969K",
      address: "x",
      city: "x",
      zipCode: "00000",
      country: "IT",
      taxRegime: taxRegime as never,
      senderType: "LIBERO_PROFESSIONISTA" as never,
    },
  });
}

async function mkClient(userId: string, name: string) {
  const { getUserDek, encryptClientInput } = await import("@/lib/data-encryption");
  const dek = await getUserDek(userId, undefined, prisma);
  const encrypted = encryptClientInput(
    { name, type: "ITALY", sdiCode: "0000000", zipCode: "10100", country: "IT" },
    dek
  );
  return prisma.client.create({ data: { userId, ...encrypted } });
}

async function mkPayment(userId: string, clientId: string, amount: number, invoiceId?: string) {
  const { getUserDek, encryptPaymentInput } = await import("@/lib/data-encryption");
  const dek = await getUserDek(userId, undefined, prisma);
  const encrypted = encryptPaymentInput(
    {
      amount,
      currency: "EUR",
      paidAt: new Date("2026-01-05"),
      description: "test",
    },
    dek
  );
  return prisma.payment.create({
    data: {
      userId,
      clientId,
      ...encrypted,
      ...(invoiceId ? { invoiceId } : {}),
    },
  });
}

async function mkInvoice(userId: string, clientId: string, paymentIds: string[], n: number) {
  const { getUserDek, encryptInvoiceInput, encryptInvoiceItemInput } = await import(
    "@/lib/data-encryption"
  );
  const dek = await getUserDek(userId, undefined, prisma);
  const encrypted = encryptInvoiceInput(
    {
      number: n,
      year: 2026,
      date: new Date("2026-01-06"),
      clientId,
      subtotalAmount: 100,
      stampDutyAmount: 0,
      totalAmount: 100,
      status: "ISSUED",
    },
    dek
  );
  return prisma.invoice.create({
    data: {
      userId,
      ...encrypted,
      items: { create: encryptInvoiceItemInput({ description: "riga", amount: 100 }, dek) },
      payments: { connect: paymentIds.map((id) => ({ id })) },
    },
  });
}

describe("security: anti escalation", () => {
  let adminJar: Jar;
  let userA: { id: string };
  let userB: { id: string };
  let userBJar: Jar;
  let clientA: { id: string };
  let clientB: { id: string };
  let payA1: { id: string };
  let payA2: { id: string };
  let invA1: { id: string };

  beforeAll(async () => {
    // Guard anti-dati-reali: parte solo su DB vuoto.
    const count = await prisma.user.count();
    if (count !== 0) {
      throw new Error(`Il DB di test non è vuoto (${count} utenti): abortito per sicurezza`);
    }
    PASSWORD_HASH = await bcrypt.hash(PASSWORD, 4); // cost basso: è solo fixture

    // Bootstrap via API: primo utente -> ADMIN.
    const jar = new Jar();
    const r = await api("POST", "/api/users", {
      jar,
      body: {
        email: "admin@test.local",
        name: "Admin",
        password: "AdminPassword123",
        businessName: "Test",
        vatNumber: "00743110157",
        taxCode: "ZRZLDA82M09D969K",
        address: "x",
        city: "x",
        zipCode: "00000",
        province: "RM",
      },
    });
    expect(r.status).toBe(201);
    expect((r.json as { role: string }).role).toBe("ADMIN");
    const l = await loginJson("admin@test.local", "AdminPassword123");
    expect(l.status).toBe(200);
    adminJar = l.jar;

    userA = await mkUser("a@test.local");
    userB = await mkUser("b@test.local");
    const lb = await loginJson("b@test.local", PASSWORD);
    expect(lb.status).toBe(200);
    userBJar = lb.jar;

    clientA = await mkClient(userA.id, "Cliente A");
    clientB = await mkClient(userB.id, "Cliente B");
    payA1 = await mkPayment(userA.id, clientA.id, 50);
    payA2 = await mkPayment(userA.id, clientA.id, 60);
    invA1 = await mkInvoice(userA.id, clientA.id, [payA2.id], 1);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test("bootstrap chiuso: anonimo riceve 403 identico con email esistente, nuova o role ADMIN nel body", async () => {
    const bodies = [
      { email: "a@test.local", name: "x", password: "xxxxxxxxxxxx", businessName: "x", vatNumber: "00743110157", taxCode: "ZRZLDA82M09D969K", address: "x", city: "x", zipCode: "00000", province: "RM" },
      { email: "mai-visto@test.local", name: "x", password: "xxxxxxxxxxxx", businessName: "x", vatNumber: "00743110157", taxCode: "ZRZLDA82M09D969K", address: "x", city: "x", zipCode: "00000", province: "RM" },
      { email: "evil@test.local", name: "x", password: "xxxxxxxxxxxx", role: "ADMIN", businessName: "x", vatNumber: "00743110157", taxCode: "ZRZLDA82M09D969K", address: "x", city: "x", zipCode: "00000", province: "RM" },
    ];
    const results = [];
    for (const b of bodies) {
      const r = await api("POST", "/api/users", { body: b });
      results.push({ status: r.status, text: r.text });
    }
    for (const res of results) {
      expect(res.status).toBe(403);
      expect(res.text).toBe(results[0].text);
    }
  });

  test("non-admin non crea utenti e non tocca /api/users", async () => {
    let r = await api("POST", "/api/users", { jar: userBJar, body: { email: "z@test.local" } });
    expect(r.status).toBe(403);
    r = await api("GET", "/api/users", { jar: userBJar });
    expect(r.status).toBe(403);
    r = await api("PUT", `/api/users/${userA.id}`, { jar: userBJar, body: { businessName: "hacked" } });
    expect(r.status).toBe(403);
    r = await api("DELETE", `/api/users/${userA.id}`, { jar: userBJar });
    expect(r.status).toBe(403);
  });

  test("PUT role viene ignorato: resta USER", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    const r = await api("PUT", `/api/users/${userB.id}`, { jar: adminJar, body: { role: "ADMIN", businessName: "Test" } });
    expect(r.status).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userB.id } });
    expect(before.role).toBe("USER");
    expect(after.role).toBe("USER");
  });

  test("admin crea senza password -> 502 con rollback (niente mail configurata qui)", async () => {
    const before = await prisma.user.count();
    const r = await api("POST", "/api/users", {
      jar: adminJar,
      body: {
        email: "noroll@test.local", name: "No Roll", businessName: "x", vatNumber: "00743110157",
        taxCode: "ZRZLDA82M09D969K", address: "x", city: "x", zipCode: "00000", province: "RM",
      },
    });
    expect(r.status).toBe(502);
    expect(await prisma.user.count()).toBe(before);
    expect(await prisma.authToken.count()).toBe(0);
  });

  test("admin crea con password nel body -> 400, niente scritture", async () => {
    const before = await prisma.user.count();
    const r = await api("POST", "/api/users", {
      jar: adminJar,
      body: {
        email: "noroll2@test.local", name: "No Roll", password: "Password123456", businessName: "x",
        vatNumber: "00743110157", taxCode: "ZRZLDA82M09D969K", address: "x", city: "x",
        zipCode: "00000", province: "RM",
      },
    });
    expect(r.status).toBe(400);
    expect(await prisma.user.count()).toBe(before);
  });

  test("/utenti come USER redirige a / (niente contenuto)", async () => {
    const r = await api("GET", "/utenti", { jar: userBJar, json: true });
    expect([301, 302, 303, 307, 308]).toContain(r.status);
    expect(r.headers.get("location")).toMatch(/\/$/);
  });

  test("orizzontale: B non legge/scrive nulla di A", async () => {
    let r = await api("GET", `/api/clients/${clientA.id}`, { jar: userBJar });
    expect(r.status).toBe(403);
    r = await api("PUT", `/api/clients/${clientA.id}`, { jar: userBJar, body: { name: "hacked" } });
    expect(r.status).toBe(403);
    r = await api("DELETE", `/api/clients/${clientA.id}`, { jar: userBJar });
    expect(r.status).toBe(403);
    r = await api("GET", `/api/payments?clientId=${clientA.id}`, { jar: userBJar });
    expect(r.status).toBe(403);
    r = await api("GET", `/api/invoices/${invA1.id}`, { jar: userBJar });
    expect(r.status).toBe(403);
    r = await api("PUT", `/api/invoices/${invA1.id}`, { jar: userBJar, body: {} });
    expect(r.status).toBe(403);
    r = await api("DELETE", `/api/invoices/${invA1.id}`, { jar: userBJar });
    expect(r.status).toBe(403);
  });

  test("orizzontale: B non collega dati di A alle proprie fatture", async () => {
    let r = await api("POST", "/api/payments", {
      jar: userBJar,
      body: { clientId: clientB.id, amount: 10, paidAt: "2026-01-05", description: "x", invoiceId: invA1.id },
    });
    expect(r.status).toBe(403);
    r = await api("POST", "/api/invoices", {
      jar: userBJar,
      body: { clientId: clientB.id, date: "2026-01-06", paymentIds: [payA1.id], items: [{ description: "x", amount: 50 }] },
    });
    expect(r.status).toBe(403);
  });

  test("integrità: niente doppi collegamenti né mix di clienti", async () => {
    const payB1 = await mkPayment(userB.id, clientB.id, 70);
    const payB2 = await mkPayment(userB.id, clientB.id, 80);
    const invB1 = await mkInvoice(userB.id, clientB.id, [payB2.id], 2);
    // payB2 già fatturato -> 400
    let r = await api("POST", "/api/invoices", {
      jar: userBJar,
      body: { clientId: clientB.id, date: "2026-01-06", paymentIds: [payB2.id], items: [{ description: "x", amount: 80 }] },
    });
    expect(r.status).toBe(400);
    // mix clienti -> 400
    const clientB2 = await mkClient(userB.id, "Cliente B2");
    const payB3 = await mkPayment(userB.id, clientB2.id, 90);
    r = await api("POST", "/api/invoices", {
      jar: userBJar,
      body: { clientId: clientB.id, date: "2026-01-06", paymentIds: [payB3.id], items: [{ description: "x", amount: 90 }] },
    });
    expect(r.status).toBe(400);
    // PUT verso fattura altrui -> 403 anche con pagamenti propri
    r = await api("PUT", `/api/invoices/${invB1.id}`, { jar: userBJar, body: { paymentIds: [payB1.id] } });
    expect(r.status).toBe(200);
    r = await api("PUT", `/api/invoices/${invA1.id}`, { jar: userBJar, body: { paymentIds: [payB1.id] } });
    expect(r.status).toBe(403);
  });

  test("login: messaggi uniformi ed error code noti", async () => {
    const a = await api("POST", "/api/login", { body: { email: "inesistente@test.local", password: "Password123456", callbackUrl: "/" } });
    const b = await api("POST", "/api/login", { body: { email: "b@test.local", password: "sbagliata-123456", callbackUrl: "/" } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.text).toBe(b.text);
  });

  test("login JSON-only: nessun redirect, callback esterno ignorato + sessione valida", async () => {
    // Il login è solo JSON (niente flusso nativo): nessun redirect, quindi nessun
    // open redirect possibile. Il callbackUrl esterno viene ignorato.
    const evil = await api("POST", "/api/login", {
      body: { email: "b@test.local", password: PASSWORD, callbackUrl: "https://evil.example.com/" },
    });
    expect(evil.status).toBe(200);
    expect(evil.headers.get("location")).toBeNull();
    expect((evil.json as { ok: boolean }).ok).toBe(true);
    const jar = new Jar();
    const ok = await api("POST", "/api/login", {
      jar,
      body: { email: "b@test.local", password: PASSWORD, callbackUrl: "/" },
    });
    expect(ok.status).toBe(200);
    expect((ok.json as { ok: boolean }).ok).toBe(true);
    const me = await api("GET", "/api/clients", { jar });
    expect(me.status).toBe(200);
  });

  test("rate limit login: all'11esimo tentativo 429", async () => {
    const ip = "10.9.9.99";
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await api("POST", "/api/login", {
        ip,
        body: { email: "b@test.local", password: "sbagliata-123456", callbackUrl: "/" },
      });
      last = r.status;
    }
    expect(last).toBe(429);
  });

  test("MFA end-to-end: enroll, login a due step, backup code monouso", async () => {
    const userC = await mkUser("c@test.local");
    const lc = await loginJson("c@test.local", PASSWORD);
    expect(lc.status).toBe(200);
    const jarC = lc.jar;
    // enroll
    let r = await api("POST", "/api/mfa", { jar: jarC, body: { action: "setup" } });
    expect(r.status).toBe(200);
    const secret = (r.json as { secret: string }).secret;
    expect(typeof secret).toBe("string");
    const { totpAt: totp } = await import("@/lib/totp");
    r = await api("POST", "/api/mfa", { jar: jarC, body: { action: "enable", code: totp(secret) } });
    expect(r.status).toBe(200);
    const codes = (r.json as { backupCodes: string[] }).backupCodes;
    expect(codes).toHaveLength(8);
    // step1 senza sessione
    const s1 = await api("POST", "/api/login", { body: { email: "c@test.local", password: PASSWORD, callbackUrl: "/" } });
    expect(s1.status).toBe(200);
    expect((s1.json as { mfaRequired: boolean }).mfaRequired).toBe(true);
    const challenge = (s1.json as { challenge: string }).challenge;
    // step2 codice errato
    const bad = await api("POST", "/api/login", { body: { challenge, totpCode: "000000", callbackUrl: "/" } });
    expect(bad.status).toBe(401);
    // step2 codice giusto
    const jar2 = new Jar();
    const good = await api("POST", "/api/login", { jar: jar2, body: { challenge, totpCode: totp(secret), callbackUrl: "/" } });
    expect(good.status).toBe(200);
    const me = await api("GET", "/api/clients", { jar: jar2 });
    expect(me.status).toBe(200);
    // backup code monouso: primo uso ok, riuso ko
    const jb = new Jar();
    const b1 = await api("POST", "/api/login", { jar: jb, body: { challenge, totpCode: codes[0], callbackUrl: "/" } });
    expect(b1.status).toBe(200);
    const b2 = await api("POST", "/api/login", { body: { challenge, totpCode: codes[0], callbackUrl: "/" } });
    expect(b2.status).toBe(401);
  }, 60000);

  test("legacy path con 2FA rifiutato e token senza versione invalidati", async () => {
    // token vecchio stile (senza sessionVersion) ma firmato correttamente
    const { encode } = await import("next-auth/jwt");
    const legacy = await encode({
      token: { sub: userA.id, id: userA.id, email: "a@test.local" } as never,
      secret: NEXTAUTH_SECRET,
      maxAge: 30 * 24 * 60 * 60,
    });
    const r = await fetch(`${BASE}/api/clients`, {
      headers: { Cookie: `next-auth.session-token=${legacy}`, Accept: "application/json" },
      redirect: "manual",
    });
    expect(r.status).toBe(401);
  });

  test("rotazione: bump versione invalida la sessione esistente", async () => {
    const l = await loginJson("b@test.local", PASSWORD);
    expect(l.status).toBe(200);
    let me = await api("GET", "/api/clients", { jar: l.jar });
    expect(me.status).toBe(200);
    await prisma.user.update({ where: { id: userB.id }, data: { sessionVersion: { increment: 1 } } });
    me = await api("GET", "/api/clients", { jar: l.jar });
    expect(me.status).toBe(401);
  });

  test("DELETE utente senza/conferma password errata -> 403; re-auth mancante su PUT rimossa", async () => {
    const userD = await mkUser("d@test.local");
    let r = await api("DELETE", `/api/users/${userD.id}`, { jar: adminJar });
    expect(r.status).toBe(403);
    r = await api("DELETE", `/api/users/${userD.id}`, { jar: adminJar, body: { currentPassword: "sbagliata-123456" } });
    expect(r.status).toBe(403);
  });

  test("audit: eventi scritti su file", async () => {
    const content: string = fs.existsSync(AUDIT_LOG) ? fs.readFileSync(AUDIT_LOG, "utf8") : "";
    expect(content).toContain("auth.alert_bruteforce");
    expect(content).toContain("user.created");
  });

  test("legacy: dati in formato precedente decifrabili + self-heal di W_pwd al login", async () => {
    const { createCipheriv, randomBytes } = await import("crypto");
    const { wrapKey, MASTER_KEY } = await import("@/lib/crypto");

    // DEK canonica avvolta in W_sys (MASTER_KEY); W_pwd ASSENTE (come nei DB migrati).
    const dek = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dek, iv);
    const ct = Buffer.concat([cipher.update("Cliente Legacy", "utf8"), cipher.final()]);
    // Formato legacy: ciphertext = base64(ct || tag), IV separato.
    const nameEnc = Buffer.concat([ct, cipher.getAuthTag()]).toString("base64");
    const nameIv = iv.toString("base64");
    const wSys = wrapKey(dek, MASTER_KEY);

    const user = await prisma.user.create({
      data: {
        email: "legacy@test.local",
        name: "Legacy",
        passwordHash: PASSWORD_HASH,
        role: "USER" as never,
        businessName: "Test",
        vatNumber: "00743110157",
        taxCode: "ZRZLDA82M09D969K",
        address: "x",
        city: "x",
        zipCode: "00000",
        country: "IT",
        taxRegime: "FORFETTARIO" as never,
        senderType: "LIBERO_PROFESSIONISTA" as never,
        userKey: { create: { argon2Salt: "", wPwd: "", wSys } },
      },
    });
    await prisma.client.create({
      data: { userId: user.id, nameEnc, nameIv, type: "ITALY" as never },
    });

    const l = await loginJson("legacy@test.local", PASSWORD);
    expect(l.status).toBe(200);

    // Lettura legacy via API (usa la DEK di sessione o il fallback W_sys).
    const res = await api("GET", "/api/clients", { jar: l.jar });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Cliente Legacy");

    // Self-heal: W_pwd riallineato alla password corrente.
    const uk = await prisma.userKey.findUnique({ where: { userId: user.id } });
    expect(uk?.wPwd && uk.wPwd.length > 0).toBe(true);
    expect(uk?.argon2Salt && uk.argon2Salt.length > 0).toBe(true);
  });

  test("ZK reset HTTP: confirmPassword obbligatorio e reset completato", async () => {
    const { createHash, randomBytes } = await import("crypto");
    const { generateUserKey, wrapDekForZKSecret } = await import("@/lib/crypto");

    const NEW = "NewPassword456";
    const secret = randomBytes(32).toString("base64url");
    const { dek, wPwd, argon2Salt } = await generateUserKey("OldPassword123");
    const { wSys, zkSalt } = await wrapDekForZKSecret(dek, secret);

    const u = await prisma.user.create({
      data: {
        email: "zkreset@test.local",
        name: "ZK Reset",
        passwordHash: PASSWORD_HASH,
        role: "USER" as never,
        businessName: "Test",
        vatNumber: "00743110157",
        taxCode: "ZRZLDA82M09D969K",
        address: "x",
        city: "x",
        zipCode: "00000",
        country: "IT",
        zeroKnowledgeEnabled: true,
        userKey: {
          create: {
            argon2Salt: argon2Salt.toString("base64"),
            wPwd,
            wSys,
            zeroKnowledgeMode: true,
            zkSalt: zkSalt.toString("base64"),
          },
        },
      },
    });

    const token = randomBytes(32).toString("hex");
    await prisma.authToken.create({
      data: {
        userId: u.id,
        type: "password_reset",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    // Senza confirmPassword -> 400 (il form inviava questo payload, bug corretto).
    const bad = await api("POST", "/api/auth/zk-password-reset", {
      body: { token, zkSecret: secret, newPassword: NEW },
    });
    expect(bad.status).toBe(400);

    // Con confirmPassword -> 200 e login con la nuova password.
    const ok = await api("POST", "/api/auth/zk-password-reset", {
      body: { token, zkSecret: secret, newPassword: NEW, confirmPassword: NEW },
    });
    expect(ok.status).toBe(200);

    const l = await loginJson("zkreset@test.local", NEW);
    expect(l.status).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Zero-Knowledge: autorizzazione per-utente e attivazione/rotazione a due fasi.
  // ---------------------------------------------------------------------------
  describe("zero-knowledge: autorizzazione e flussi a due fasi", () => {
    let jarA: Jar;
    let jarB: Jar;
    let pendingA = "";

    const ZK = (action: string) => `/api/auth/zero-knowledge/${action}`;
    const statusOf = async (jar: Jar) => {
      const r = await api("GET", ZK("status"), { jar });
      return (r.json as { enabled: boolean }).enabled;
    };
    const userKeyOf = (id: string) =>
      prisma.userKey.findUnique({ where: { userId: id }, select: { wSys: true, zkSalt: true } });

    beforeAll(async () => {
      const la = await loginJson("a@test.local", PASSWORD);
      expect(la.status).toBe(200);
      jarA = la.jar;
      const lb = await loginJson("b@test.local", PASSWORD);
      expect(lb.status).toBe(200);
      jarB = lb.jar;
    });

    test("prepare genera la chiave ma NON attiva (status resta disabled)", async () => {
      expect(await statusOf(jarA)).toBe(false);
      const before = await userKeyOf(userA.id);

      const r = await api("POST", ZK("enable"), { jar: jarA, body: { action: "prepare" } });
      expect(r.status).toBe(200);
      const data = r.json as { recoveryKey: string; pendingToken: string };
      expect(typeof data.recoveryKey).toBe("string");
      expect(data.recoveryKey.length).toBeGreaterThanOrEqual(43);
      expect(typeof data.pendingToken).toBe("string");
      pendingA = data.pendingToken;

      expect(await statusOf(jarA)).toBe(false);
      const stored = await prisma.user.findUnique({
        where: { id: userA.id },
        select: { zeroKnowledgeEnabled: true, userKey: { select: { zeroKnowledgeMode: true } } },
      });
      expect(stored?.zeroKnowledgeEnabled).toBe(false);
      expect(stored?.userKey?.zeroKnowledgeMode).toBe(false);
      const after = await userKeyOf(userA.id);
      expect(after?.wSys).toBe(before?.wSys);
      expect(after?.zkSalt).toBe(before?.zkSalt);
    });

    test("il pendingToken di A è rifiutato su B (e se manomesso)", async () => {
      // B tenta di committare l'attivazione con il token preparato per A.
      const cross = await api("POST", ZK("enable"), {
        jar: jarB,
        body: { action: "confirm", pendingToken: pendingA, confirmDisclaimer: true },
      });
      expect(cross.status).toBe(400);
      expect(await statusOf(jarB)).toBe(false);

      // Token manomesso -> firma non valida.
      const tampered = pendingA.slice(0, -3) + "xyz";
      const bad = await api("POST", ZK("enable"), {
        jar: jarA,
        body: { action: "confirm", pendingToken: tampered, confirmDisclaimer: true },
      });
      expect(bad.status).toBe(400);
      expect(await statusOf(jarA)).toBe(false);
    });

    test("confirm SENZA disclaimer viene rifiutato", async () => {
      const r = await api("POST", ZK("enable"), {
        jar: jarA,
        body: { action: "confirm", pendingToken: pendingA, confirmDisclaimer: false },
      });
      expect(r.status).toBe(400);
      expect(await statusOf(jarA)).toBe(false);
    });

    test("confirm committa l'attivazione senza incrementare sessionVersion", async () => {
      const before = await prisma.user.findUnique({
        where: { id: userA.id },
        select: { sessionVersion: true },
      });
      const r = await api("POST", ZK("enable"), {
        jar: jarA,
        body: { action: "confirm", pendingToken: pendingA, confirmDisclaimer: true },
      });
      expect(r.status).toBe(200);
      expect(await statusOf(jarA)).toBe(true);

      const after = await prisma.user.findUnique({
        where: { id: userA.id },
        select: { zeroKnowledgeEnabled: true, sessionVersion: true, userKey: { select: { zeroKnowledgeMode: true } } },
      });
      expect(after?.zeroKnowledgeEnabled).toBe(true);
      expect(after?.userKey?.zeroKnowledgeMode).toBe(true);
      expect(after?.sessionVersion).toBe(before?.sessionVersion);

      // Replay dello stesso token: utente già ZK -> 409, nessun secondo commit.
      const replay = await api("POST", ZK("enable"), {
        jar: jarA,
        body: { action: "confirm", pendingToken: pendingA, confirmDisclaimer: true },
      });
      expect(replay.status).toBe(409);
    });

    test("rotazione: prepare con password errata -> 401 e nessuna modifica", async () => {
      const before = await userKeyOf(userA.id);
      const r = await api("POST", ZK("rotate-secret"), {
        jar: jarA,
        body: { action: "prepare", password: "WrongPassword123" },
      });
      expect(r.status).toBe(401);
      const after = await userKeyOf(userA.id);
      expect(after?.wSys).toBe(before?.wSys);
      expect(after?.zkSalt).toBe(before?.zkSalt);
    });

    test("rotazione two-phase: commit solo al confirm, token altrui rifiutato", async () => {
      const before = await userKeyOf(userA.id);
      const prep = await api("POST", ZK("rotate-secret"), {
        jar: jarA,
        body: { action: "prepare", password: PASSWORD },
      });
      expect(prep.status).toBe(200);
      const { newRecoveryKey, pendingToken } = prep.json as {
        newRecoveryKey: string;
        pendingToken: string;
      };
      expect(newRecoveryKey.length).toBeGreaterThanOrEqual(43);

      // Ancora nessun commit: la vecchia chiave resta quella valida.
      const mid = await userKeyOf(userA.id);
      expect(mid?.wSys).toBe(before?.wSys);
      expect(mid?.zkSalt).toBe(before?.zkSalt);

      // B non può committare la rotazione di A (409: B non è ZK).
      const cross = await api("POST", ZK("rotate-secret"), {
        jar: jarB,
        body: { action: "confirm", pendingToken },
      });
      expect([400, 409]).toContain(cross.status);
      expect((await userKeyOf(userA.id))?.wSys).toBe(before?.wSys);

      // Commit legittimo.
      const conf = await api("POST", ZK("rotate-secret"), {
        jar: jarA,
        body: { action: "confirm", pendingToken },
      });
      expect(conf.status).toBe(200);
      const after = await userKeyOf(userA.id);
      expect(after?.wSys).not.toBe(before?.wSys);
      expect(after?.zkSalt).not.toBe(before?.zkSalt);

      // Replay del token di rotazione: già committato... il token è ancora
      // valido finché non scade, ma riapplicarlo non deve corrompere nulla.
      const again = await api("POST", ZK("rotate-secret"), {
        jar: jarA,
        body: { action: "confirm", pendingToken },
      });
      expect(again.status).toBe(200);
      const end = await userKeyOf(userA.id);
      expect(end?.wSys).toBe(after?.wSys);
    });

    test("la rotazione della chiave NON invalida un token di reset pendente", async () => {
      const { createHash } = await import("crypto");

      // Token di reset pendente creato direttamente sul DB di test.
      const token = "a".repeat(63) + "b";
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await prisma.authToken.create({
        data: {
          userId: userA.id,
          type: "password_reset",
          tokenHash,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      const prep = await api("POST", ZK("rotate-secret"), {
        jar: jarA,
        body: { action: "prepare", password: PASSWORD },
      });
      expect(prep.status).toBe(200);
      const { pendingToken } = prep.json as { pendingToken: string };
      const conf = await api("POST", ZK("rotate-secret"), {
        jar: jarA,
        body: { action: "confirm", pendingToken },
      });
      expect(conf.status).toBe(200);

      // Il token di reset deve essere ancora presente e non usato.
      const still = await prisma.authToken.findUnique({ where: { tokenHash } });
      expect(still).not.toBeNull();
      expect(still?.usedAt).toBeNull();
    });

    test("disattivazione: password obbligatoria, B bloccato, A completa", async () => {
      let r = await api("POST", ZK("disable"), {
        jar: jarA,
        body: { password: "WrongPassword123" },
      });
      expect(r.status).toBe(401);
      expect(await statusOf(jarA)).toBe(true);

      // B non è ZK: non può disattivare l'account di A.
      r = await api("POST", ZK("disable"), { jar: jarB, body: { password: PASSWORD } });
      expect(r.status).toBe(409);
      expect(await statusOf(jarA)).toBe(true);

      r = await api("POST", ZK("disable"), { jar: jarA, body: { password: PASSWORD } });
      expect(r.status).toBe(200);
      expect(await statusOf(jarA)).toBe(false);
    });

    test("revoke-sessions: admin revoca le sessioni di un utente", async () => {
      const before = await prisma.user.findUnique({ where: { id: userB.id }, select: { sessionVersion: true } });
      expect(before?.sessionVersion).toBeDefined();

      const r = await api("POST", `/api/users/${userB.id}/revoke-sessions`, { jar: adminJar });
      expect(r.status).toBe(200);

      const after = await prisma.user.findUnique({ where: { id: userB.id }, select: { sessionVersion: true } });
      expect(after?.sessionVersion).toBe((before?.sessionVersion ?? 0) + 1);

      // La vecchia sessione di B ora è invalida.
      const me = await api("GET", "/api/clients", { jar: jarB });
      expect(me.status).toBe(401);
    });

    test("revoke-sessions: non-admin riceve 403", async () => {
      // Login fresco di B (le sue sessioni precedenti sono state revocate dal test sopra).
      const lb = await loginJson("b@test.local", PASSWORD);
      expect(lb.status).toBe(200);
      const r = await api("POST", `/api/users/${userA.id}/revoke-sessions`, { jar: lb.jar });
      expect(r.status).toBe(403);
    });

    test("revoke-sessions: admin può revocare le proprie sessioni", async () => {
      const admin = await prisma.user.findUnique({ where: { email: "admin@test.local" } });
      expect(admin).not.toBeNull();
      const before = admin!.sessionVersion;

      const r = await api("POST", `/api/users/${admin!.id}/revoke-sessions`, { jar: adminJar });
      expect(r.status).toBe(200);

      const after = await prisma.user.findUnique({ where: { id: admin!.id }, select: { sessionVersion: true } });
      expect(after?.sessionVersion).toBe(before + 1);

      // La sessione dell'admin ora è invalida.
      const me = await api("GET", "/api/clients", { jar: adminJar });
      expect(me.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Prestazione occasionale: niente XML SdI, solo ricevuta PDF.
  // ---------------------------------------------------------------------------
  describe("prestazione occasionale: export", () => {
    let jarO: Jar;
    let invO: { id: string };

    beforeAll(async () => {
      const userO = await mkUser("o@test.local", "USER", "PRESTAZIONE_OCCASIONALE");
      const login = await loginJson("o@test.local", PASSWORD);
      expect(login.status).toBe(200);
      jarO = login.jar;

      const clientO = await mkClient(userO.id, "Cliente Occasionale");
      const payO = await mkPayment(userO.id, clientO.id, 100);
      const created = await api("POST", "/api/invoices", {
        jar: jarO,
        body: {
          clientId: clientO.id,
          date: "2026-01-06",
          paymentIds: [payO.id],
          items: [{ description: "Consulenza", amount: 100 }],
        },
      });
      expect(created.status).toBe(201);
      invO = created.json as { id: string };
    });

    test("export XML bloccato con 403 e stato invariato", async () => {
      const xml = await api("GET", `/api/invoices/${invO.id}?format=xml`, { jar: jarO });
      expect(xml.status).toBe(403);
      expect((xml.json as { error: string }).error).toMatch(/SdI/i);

      const stored = await prisma.invoice.findUnique({
        where: { id: invO.id },
        select: { status: true },
      });
      expect(stored?.status).toBe("DRAFT");
    });

    test("export PDF attivo come ricevuta", async () => {
      const pdf = await api("GET", `/api/invoices/${invO.id}?format=pdf`, { jar: jarO });
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toContain("application/pdf");
      const disposition = pdf.headers.get("content-disposition") || "";
      expect(disposition).toContain("ricevuta_1_2026.pdf");
      expect(disposition).not.toContain("fattura_");
    });
  });
});
