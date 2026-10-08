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

async function mkUser(email: string, role: "ADMIN" | "USER" = "USER") {
  return prisma.user.create({
    data: {
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
      taxRegime: "FORFETTARIO" as never,
      senderType: "LIBERO_PROFESSIONISTA" as never,
    },
  });
}

async function mkClient(userId: string, name: string) {
  return prisma.client.create({
    data: {
      userId,
      name,
      type: "ITALY" as never,
      sdiCode: "0000000",
      zipCode: "10100",
      country: "IT",
    },
  });
}

async function mkPayment(userId: string, clientId: string, amount: number, invoiceId?: string) {
  return prisma.payment.create({
    data: {
      userId,
      clientId,
      amount,
      paidAt: new Date("2026-01-05"),
      description: "test",
      ...(invoiceId ? { invoiceId } : {}),
    },
  });
}

async function mkInvoice(userId: string, clientId: string, paymentIds: string[], n: number) {
  return prisma.invoice.create({
    data: {
      userId,
      number: n,
      year: 2026,
      date: new Date("2026-01-06"),
      clientId,
      subtotalAmount: 100,
      stampDutyAmount: 0,
      totalAmount: 100,
      status: "ISSUED" as never,
      items: { create: { description: "riga", amount: 100 } },
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

  test("login nativo: open redirect bloccato, callback ok + sessione valida", async () => {
    // Senza header Accept: JSON -> il server risponde con redirect 303 (flusso nativo).
    const evil = await api("POST", "/api/login", {
      json: false,
      body: { email: "b@test.local", password: PASSWORD, callbackUrl: "https://evil.example.com/" },
    });
    expect(evil.status).toBe(303);
    // L'host esterno deve essere neutralizzato: redirect solo same-origin verso "/".
    const evilUrl = new URL(evil.headers.get("location") || "", BASE);
    expect(evilUrl.origin).toBe(new URL(BASE).origin);
    expect(evilUrl.pathname).toBe("/");
    const jar = new Jar();
    const ok = await api("POST", "/api/login", {
      jar,
      json: false,
      body: { email: "b@test.local", password: PASSWORD, callbackUrl: "/" },
    });
    expect(ok.status).toBe(303);
    const okUrl = new URL(ok.headers.get("location") || "", BASE);
    expect(okUrl.origin).toBe(new URL(BASE).origin);
    expect(okUrl.pathname).toBe("/");
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
});
