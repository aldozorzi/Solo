import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';

const userSettingsSchema = z.object({
  businessName: z.string().min(1, 'Denominazione obbligatoria'),
  vatNumber: z.string().length(11, 'Partita IVA deve essere 11 cifre'),
  taxCode: z.string().length(16, 'Codice Fiscale deve essere 16 caratteri'),
  address: z.string().min(1, 'Indirizzo obbligatorio'),
  city: z.string().min(1, 'Comune obbligatorio'),
  zipCode: z.string().length(5, 'CAP deve essere 5 cifre'),
  province: z.string().length(2, 'Provincia (sigla, 2 caratteri)'),
  country: z.string().default('IT'),
  taxRegime: z.enum(['FORFETTARIO', 'ORDINARIO']),
});

async function getUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('Non autenticato');
  }
  return session.user.id;
}

export async function GET() {
  try {
    const userId = await getUserId();
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        businessName: true,
        vatNumber: true,
        taxCode: true,
        address: true,
        city: true,
        zipCode: true,
        province: true,
        country: true,
        taxRegime: true,
      },
    });
    
    if (!user) {
      return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 });
    }
    
    return NextResponse.json({
      senderName: user.businessName,
      senderVat: user.vatNumber,
      senderTaxCode: user.taxCode,
      senderAddress: user.address,
      senderNumber: 'SNC',
      senderZip: user.zipCode,
      senderCity: user.city,
      senderProvince: user.province || 'RM',
      senderCountry: user.country,
      senderTaxRegime: user.taxRegime,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Non autenticato') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Errore nel recupero impostazioni' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await getUserId();
    const body = await request.json();
    const data = userSettingsSchema.parse(body);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        businessName: data.businessName,
        vatNumber: data.vatNumber,
        taxCode: data.taxCode,
        address: data.address,
        city: data.city,
        zipCode: data.zipCode,
        province: data.province,
        country: data.country,
        taxRegime: data.taxRegime,
      },
      select: {
        businessName: true,
        vatNumber: true,
        taxCode: true,
        address: true,
        city: true,
        zipCode: true,
        province: true,
        country: true,
        taxRegime: true,
      },
    });
    
    return NextResponse.json({
      senderName: user.businessName,
      senderVat: user.vatNumber,
      senderTaxCode: user.taxCode,
      senderAddress: user.address,
      senderNumber: 'SNC',
      senderZip: user.zipCode,
      senderCity: user.city,
      senderProvince: user.province || 'RM',
      senderCountry: user.country,
      senderTaxRegime: user.taxRegime,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    if (error instanceof Error && error.message === 'Non autenticato') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Error updating settings:', error);
    return NextResponse.json({ error: 'Errore nell\'aggiornamento impostazioni' }, { status: 500 });
  }
}