import type { PrismaClient } from '@prisma/client';
import { createTemporaryPostgresDatabase, type TemporaryPostgresDatabase } from '../support/temporary-postgres';
import {
  buildMatrixCases,
  buildMatrixXml,
  checkCombinationXml,
  createMatrixClient,
  createMatrixInvoice,
  createMatrixPayments,
  createMatrixUser,
  expectedTotalsFor,
  formatReportLine,
  type CombinationReport,
  type MatrixCase,
} from '../support/xml-matrix';
import fs from 'node:fs';
import path from 'node:path';

const CASES = buildMatrixCases();
const WRITE_FILES = process.env.XML_MATRIX_WRITE_FILES === '1';
const OUT_DIR = path.resolve(process.cwd(), process.env.XML_MATRIX_OUT_DIR ?? 'test-output');

let database: TemporaryPostgresDatabase;
let prisma: PrismaClient;
const contexts = new Map<
  string,
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: any;
    clients: Record<string, any>;
  }
>();
const invoiceNumbers = new Map<string, number>();
const completedReports = new Map<string, { report: CombinationReport; xml: string }>();

beforeAll(async () => {
  database = await createTemporaryPostgresDatabase({ cwd: process.cwd() });
  const { PrismaClient: PrismaClientConstructor } = await import('@prisma/client');
  prisma = new PrismaClientConstructor({
    datasources: { db: { url: database.url } },
  } as never) as PrismaClient;
  await prisma.$connect();

  const runId = database.name.replace(/^solo_xml_/, '');
  for (const matrixCase of CASES) {
    const userKey = `${matrixCase.senderType}/${matrixCase.taxRegime}`;
    if (!contexts.has(userKey)) {
      const user = await createMatrixUser(prisma, matrixCase.senderType, matrixCase.taxRegime, runId);
      contexts.set(userKey, { user, clients: {} });
    }
  }
}, 180000);

afterAll(async () => {
  try {
    if (WRITE_FILES && completedReports.size === CASES.length) {
      fs.rmSync(OUT_DIR, { recursive: true, force: true });
      fs.mkdirSync(OUT_DIR, { recursive: true });
      for (const { report, xml } of completedReports.values()) {
        fs.writeFileSync(path.join(OUT_DIR, report.fileName), xml);
      }
      console.log(`File scritti: ${completedReports.size} in ${OUT_DIR}`);
    } else if (WRITE_FILES) {
      console.log(`File non scritti: completati ${completedReports.size}/${CASES.length}`);
    }
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    if (database) await database.drop();
  }
});

for (const matrixCase of CASES satisfies MatrixCase[]) {
  test(`${matrixCase.senderType} ${matrixCase.taxRegime} ${matrixCase.client.fileLabel} ${matrixCase.paymentCount} pagamenti`, async () => {
    const context = contexts.get(`${matrixCase.senderType}/${matrixCase.taxRegime}`);
    if (!context) throw new Error(`Contesto utente mancante per ${matrixCase.key}`);

    let client = context.clients[matrixCase.client.clientType];
    if (!client) {
      client = await createMatrixClient(prisma, context.user.id, matrixCase.client);
      context.clients[matrixCase.client.clientType] = client;
    }

    const invoiceNumber = (invoiceNumbers.get(context.user.id) ?? 0) + 1;
    invoiceNumbers.set(context.user.id, invoiceNumber);
    const totals = expectedTotalsFor(
      matrixCase.senderType,
      matrixCase.taxRegime,
      matrixCase.client.clientType
    );
    const payments = await createMatrixPayments(
      prisma,
      context.user.id,
      client.id,
      matrixCase.paymentFixtures
    );
    const invoice = await createMatrixInvoice(
      prisma,
      context.user.id,
      client.id,
      payments.map((payment) => payment.id),
      invoiceNumber,
      totals
    );
    const xml = buildMatrixXml({ user: context.user, invoice, totals });
    const report = checkCombinationXml({ matrixCase, totals, xml });
    completedReports.set(matrixCase.key, { report, xml });
    console.log(formatReportLine(report));
  }, 120000);
}
