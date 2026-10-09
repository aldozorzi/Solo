// Carica .env in process.env (solo chiavi mancanti) prima dei test:
// i moduli di cifratura leggono MASTER_KEY all'import.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const noExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const i = noExport.indexOf('=');
    if (i < 0) continue;
    const key = noExport.slice(0, i).trim();
    if (process.env[key] !== undefined) continue;
    let value = noExport.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
