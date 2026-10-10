'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { FileText, LogOut, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Toaster } from '@/components/ui/sonner';
import { InvoiceForm } from './InvoiceForm';
import { MainNav } from './MainNav';
import { PaymentForm } from './PaymentForm';
import { ThemeSelector } from './ThemeSelector';
import { formatCurrency } from '@/lib/tax';
import type { DecryptedClient, PaymentWithRelations, UserRole, UserSession } from '@/types';
import { TAX_REGIME_LABELS, USER_ROLE_LABELS } from '@/types';

export interface HomePendingPayment {
  id: string;
  clientId: string;
  description: string;
  amount: number;
  paidAt: string;
  client: DecryptedClient;
}

export interface HomeMonthlyRevenue {
  month: number;
  label: string;
  total: number;
  count: number;
}

export interface HomeSummary {
  businessName: string;
  displayName: string;
  role: UserRole;
  taxRegimeLabel: string;
  paymentCount: number;
  pendingCount: number;
  pendingTotal: number;
  invoiceCount: number;
  draftsCount: number;
  draftsTotal: number;
  revenueYear: number;
  annualRevenueTotal: number;
  annualRevenueCount: number;
  monthlyRevenue: HomeMonthlyRevenue[];
}

interface HomeDashboardProps {
  user: UserSession;
  summary: HomeSummary;
  clients: DecryptedClient[];
  pendingPayments: HomePendingPayment[];
}

function formatCompactEuro(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function AttentionBadge({ count, label, href }: { count: number; label: string; href: string }) {
  if (count === 0) {
    return <Badge variant="secondary">{`0 ${label}`}</Badge>;
  }

  return (
    <Link href={href} aria-label={`${count} ${label}: apri la pagina corrispondente`}>
      <Badge className="attention-badge">{`${count} ${label}`}</Badge>
    </Link>
  );
}

function AnnualRevenueChart({
  year,
  monthlyRevenue,
}: {
  year: number;
  monthlyRevenue: HomeMonthlyRevenue[];
}) {
  const width = 720;
  const height = 260;
  const paddingLeft = 56;
  const paddingRight = 12;
  const paddingTop = 28;
  const paddingBottom = 30;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const maxTotal = Math.max(1, ...monthlyRevenue.map((month) => month.total));
  const slotWidth = chartWidth / monthlyRevenue.length;
  const barWidth = Math.min(42, slotWidth * 0.58);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-64 w-full"
      role="img"
      aria-label={`Incassi mensili ${year}`}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = paddingTop + chartHeight * (1 - fraction);
        return (
          <g key={fraction}>
            <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="var(--border)" strokeWidth={1} />
            <text x={paddingLeft - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
              {formatCompactEuro(maxTotal * fraction)}
            </text>
          </g>
        );
      })}
      {monthlyRevenue.map((month, index) => {
        const barHeight = (month.total / maxTotal) * chartHeight;
        const x = paddingLeft + slotWidth * index + (slotWidth - barWidth) / 2;
        const y = paddingTop + chartHeight - barHeight;
        return (
          <g key={month.month}>
            <title>{`${month.label} ${year}: ${formatCurrency(month.total)} (${month.count} incassi)`}</title>
            <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, month.total > 0 ? 3 : 0)} rx={5} fill="var(--primary)" />
            {month.total > 0 && (
              <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="var(--foreground)">
                {formatCompactEuro(month.total)}
              </text>
            )}
            <text
              x={x + barWidth / 2}
              y={height - 10}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted-foreground)"
            >
              {month.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function HomeDashboard({
  user,
  summary,
  clients,
  pendingPayments,
}: HomeDashboardProps) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const isOccasionale = user.taxRegime === 'PRESTAZIONE_OCCASIONALE';

  const handleSignOut = async () => {
    await fetch('/api/login', { method: 'DELETE' }).catch(() => undefined);
    await signOut({ callbackUrl: '/login' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {summary.businessName} • {USER_ROLE_LABELS[user.role]} • {TAX_REGIME_LABELS[user.taxRegime]}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <ThemeSelector />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSignOut} title="Esci">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
          <span className="text-sm text-muted-foreground">{summary.displayName}</span>
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
            {summary.displayName.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      <MainNav
        isAdmin={user.role === 'ADMIN'}
        counts={{
          payments: summary.pendingCount,
          invoices: summary.invoiceCount,
          clients: clients.length,
        }}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="stat-tile stat-tile-payments">
                <Receipt className="w-5 h-5" />
              </div>
              <AttentionBadge count={summary.pendingCount} label="da fatturare" href="/incassi" />
            </div>
            <CardTitle className="dashboard-title mt-4">Incassi</CardTitle>
            <CardDescription>Totale incassi ancora da fatturare</CardDescription>
            <div className="dashboard-amount text-2xl font-semibold tabular-nums">{formatCurrency(summary.pendingTotal)}</div>
            <div className="text-sm text-muted-foreground">
              {summary.paymentCount} incassi totali • {summary.pendingCount} da fatturare
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <PaymentForm clients={clients} onSuccess={refresh} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="stat-tile stat-tile-invoices">
                <FileText className="w-5 h-5" />
              </div>
              <AttentionBadge count={summary.draftsCount} label="da saldare" href="/fatture" />
            </div>
            <CardTitle className="dashboard-title mt-4">{isOccasionale ? 'Ricevute' : 'Fatture'}</CardTitle>
            <CardDescription>{isOccasionale ? 'Ricevute da saldare' : 'Fatture da saldare'}</CardDescription>
            <div className="dashboard-amount text-2xl font-semibold tabular-nums">{formatCurrency(summary.draftsTotal)}</div>
            <div className="text-sm text-muted-foreground">
              {summary.invoiceCount} {isOccasionale ? 'ricevute totali' : 'fatture totali'} • {summary.draftsCount} da saldare
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <InvoiceForm
                clients={clients}
                pendingPayments={pendingPayments as unknown as PaymentWithRelations[]}
                onSuccess={refresh}
              />
            </div>
          </CardContent>
        </Card>

      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="space-y-1.5">
              <CardTitle className="dashboard-title">Incassi {summary.revenueYear}</CardTitle>
              <CardDescription>Totale mensile degli incassi registrati</CardDescription>
            </div>
            <div className="space-y-1.5 text-right">
              <div className="dashboard-amount text-2xl font-semibold tabular-nums">{formatCurrency(summary.annualRevenueTotal)}</div>
              <div className="text-sm text-muted-foreground">
                {summary.annualRevenueCount} incassi nel {summary.revenueYear}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {summary.annualRevenueTotal > 0 ? (
            <AnnualRevenueChart year={summary.revenueYear} monthlyRevenue={summary.monthlyRevenue} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nessun incasso registrato nel {summary.revenueYear}.
            </p>
          )}
        </CardContent>
      </Card>

      <Toaster position="bottom-right" />
    </div>
  );
}
