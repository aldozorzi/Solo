import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      zeroKnowledgeEnabled: true,
      zeroKnowledgeActivatedAt: true,
      userKey: {
        select: {
          zeroKnowledgeMode: true,
          zkSalt: true
        }
      }
    }
  });

  if (!user) {
    return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 });
  }

  return NextResponse.json({
    enabled: user.zeroKnowledgeEnabled,
    activatedAt: user.zeroKnowledgeActivatedAt,
    hasKey: !!user.userKey?.zkSalt
  });
}