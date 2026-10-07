import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface TemporaryPostgresDatabase {
  name: string;
  url: string;
  drop: () => Promise<void>;
}

function readDotEnvValue(cwd: string, name: string): string | undefined {
  const direct = process.env[name];
  if (direct && direct.length > 0) return direct;

  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return undefined;

  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator < 0) continue;
    const key = withoutExport.slice(0, separator).trim();
    if (key !== name) continue;
    let value = withoutExport.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }

  return undefined;
}

function replaceDatabaseName(databaseUrl: string, databaseName: string): string {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

function uniqueDatabaseName(): string {
  const random = crypto.randomBytes(4).toString('hex');
  return `solo_xml_${Date.now().toString(36)}_${process.pid.toString(36)}_${random}`.slice(0, 60);
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(identifier)) {
    throw new Error(`Invalid temporary database name: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function createTemporaryPostgresDatabase(options: {
  cwd?: string;
  sourceUrl?: string;
  databaseName?: string;
  keepOnFailure?: boolean;
} = {}): Promise<TemporaryPostgresDatabase> {
  const cwd = options.cwd ?? process.cwd();
  const sourceUrl = options.sourceUrl ?? readDotEnvValue(cwd, 'TEST_DATABASE_URL') ?? readDotEnvValue(cwd, 'DATABASE_URL');
  if (!sourceUrl) {
    throw new Error('Missing TEST_DATABASE_URL or DATABASE_URL. Set the source PostgreSQL connection string.');
  }

  const sourceDatabase = new URL(sourceUrl).pathname.replace(/^\//, '');
  if (sourceDatabase.startsWith('solo_xml_')) {
    throw new Error(`Refusing to use ${sourceDatabase} as the source/admin database.`);
  }

  const name = options.databaseName ?? uniqueDatabaseName();
  const url = replaceDatabaseName(sourceUrl, name);
  const { PrismaClient } = (await import('@prisma/client')) as typeof import('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: sourceUrl } } } as never);

  try {
    await admin.$connect();
    await admin.$executeRawUnsafe(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } catch (error) {
    await admin.$disconnect().catch(() => undefined);
    throw new Error(`Unable to create temporary PostgreSQL database ${name}: ${(error as Error).message}`);
  }

  const schemaProcess = spawnSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--schema', path.join(cwd, 'prisma', 'schema.prisma')],
    { cwd, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' }
  );
  if (schemaProcess.status !== 0) {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`).catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
    const details = [schemaProcess.stdout, schemaProcess.stderr].filter(Boolean).join('\n');
    throw new Error(`Unable to apply Prisma schema to ${name}.\n${details}`);
  }

  const drop = async () => {
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
    } finally {
      await admin.$disconnect().catch(() => undefined);
    }
  };

  return { name, url, drop };
}
