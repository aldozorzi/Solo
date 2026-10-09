import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { auditEvent } from '@/lib/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
    }

    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Accesso negato: solo amministratori' }, { status: 403 });
    }

    const { id } = await params;

    // Verifica che l'utente target esista
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 });
    }

    // Revoca tutte le sessioni incrementando la sessionVersion
    await prisma.user.update({
      where: { id },
      data: { sessionVersion: { increment: 1 } },
    });

    await auditEvent({
      type: 'user.sessions_revoked',
      actor: session.user.id,
      target: id,
      details: { targetEmail: targetUser.email },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Non autenticato') {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error('Error revoking sessions:', error);
    return NextResponse.json({ error: 'Errore durante la revoca delle sessioni' }, { status: 500 });
  }
}