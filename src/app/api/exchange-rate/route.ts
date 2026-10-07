import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const BDI_BASE_URL =
  'https://tassidicambio.bancaditalia.it/terzevalute-wf-web/rest/v1.0';

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (YYYY-MM-DD)'),
  currency: z.string().regex(/^[A-Za-z]{3}$/, 'Valuta non valida (codice ISO a 3 lettere)'),
  amount: z.coerce.number().positive('Importo deve essere positivo').optional(),
});

interface CachedRate {
  rate: number;
  referenceDate: string;
}

// Le quotazioni storiche giornaliere non cambiano mai: cache permanente per coppia valuta/data.
const rateCache = new Map<string, CachedRate>();

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchDailyRate(
  currency: string,
  date: string
): Promise<CachedRate | null> {
  const key = `${currency}:${date}`;
  const cached = rateCache.get(key);
  if (cached) return cached;

  const url =
    `${BDI_BASE_URL}/dailyRates?referenceDate=${encodeURIComponent(date)}` +
    `&baseCurrencyIsoCode=${encodeURIComponent(currency)}` +
    `&currencyIsoCode=EUR&lang=it`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Banca d'Italia: servizio non disponibile (HTTP ${res.status})`);
  }
  const data = await res.json();
  const rates = Array.isArray(data?.rates) ? data.rates : [];
  const found = rates.find(
    (r: any) => (r?.isoCode || '').toUpperCase() === currency
  );
  if (!found?.avgRate) return null;
  const rate = parseFloat(String(found.avgRate).replace(',', '.'));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const result = { rate, referenceDate: found.referenceDate || date };
  rateCache.set(key, result);
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      date: searchParams.get('date'),
      currency: searchParams.get('currency'),
      amount: searchParams.get('amount') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const { date, amount } = parsed.data;
    const currency = parsed.data.currency.toUpperCase();

    const check = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(check.getTime())) {
      return NextResponse.json({ error: 'Data non valida' }, { status: 400 });
    }

    if (currency === 'EUR') {
      return NextResponse.json({
        currency,
        requestedDate: date,
        referenceDate: date,
        rate: 1,
        fallbackUsed: false,
        ...(amount !== undefined
          ? { eurAmount: Math.round(amount * 100) / 100 }
          : {}),
      });
    }

    // Nei weekend/festivi non ci sono quotazioni: si risale ai giorni precedenti.
    let current = date;
    let found: CachedRate | null = null;
    for (let i = 0; i < 10; i++) {
      found = await fetchDailyRate(currency, current);
      if (found) break;
      current = shiftDate(current, -1);
    }
    if (!found) {
      return NextResponse.json(
        { error: 'Nessuna quotazione disponibile per la valuta nella data indicata (ultimi 10 giorni)' },
        { status: 404 }
      );
    }

    // Con currencyIsoCode=EUR il tasso è valuta estera per 1 Euro.
    const eurAmount =
      amount !== undefined ? Math.round((amount / found.rate) * 100) / 100 : undefined;

    return NextResponse.json({
      currency,
      requestedDate: date,
      referenceDate: found.referenceDate,
      rate: found.rate,
      fallbackUsed: found.referenceDate !== date,
      ...(eurAmount !== undefined ? { eurAmount } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Banca d\'Italia: servizio non raggiungibile (timeout)' },
        { status: 502 }
      );
    }
    console.error('Error fetching exchange rate:', error);
    return NextResponse.json({ error: 'Errore nel recupero del cambio' }, { status: 502 });
  }
}
