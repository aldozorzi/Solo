import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HomeDashboard from "@/components/HomeDashboard";
import type { UserSession } from "@/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as UserSession).id;
  const revenueYear = new Date().getFullYear();
  const revenueStart = new Date(Date.UTC(revenueYear, 0, 1));
  const revenueEnd = new Date(Date.UTC(revenueYear + 1, 0, 1));
  const [profile, pendingPayments, pendingStats, paymentCount, draftStats, invoiceCount, annualInvoices, clients] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          businessName: true,
          role: true,
          taxRegime: true,
        },
      }),
      prisma.payment.findMany({
        where: { userId, invoiceId: null },
        include: { client: true },
        orderBy: { paidAt: "desc" },
      }),
      prisma.payment.aggregate({
        where: { userId, invoiceId: null },
        _count: { id: true },
        _sum: { amount: true },
      }),
      prisma.payment.count({ where: { userId } }),
      prisma.invoice.aggregate({
        where: { userId, status: "DRAFT" },
        _count: { id: true },
        _sum: { subtotalAmount: true },
      }),
      prisma.invoice.count({ where: { userId } }),
      prisma.invoice.findMany({
        where: {
          userId,
          status: { in: ["ISSUED", "PAID"] },
          date: { gte: revenueStart, lt: revenueEnd },
        },
        select: { date: true, totalAmount: true },
      }),
      prisma.client.findMany({
        where: { userId },
        orderBy: { name: "asc" },
      }),
    ]);

  if (!profile) {
    redirect("/login");
  }

  const serializedPendingPayments = pendingPayments.map((payment) => ({
    id: payment.id,
    clientId: payment.clientId,
    description: payment.description,
    amount: Number(payment.amount),
    paidAt: payment.paidAt.toISOString(),
    client: payment.client,
  }));

  const monthLabels = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const monthlyRevenue = monthLabels.map((label, month) => ({ month, label, total: 0, count: 0 }));
  let annualRevenueTotal = 0;
  for (const invoice of annualInvoices) {
    const amount = Number(invoice.totalAmount);
    const month = new Date(invoice.date).getUTCMonth();
    monthlyRevenue[month].total = Math.round((monthlyRevenue[month].total + amount) * 100) / 100;
    monthlyRevenue[month].count += 1;
    annualRevenueTotal = Math.round((annualRevenueTotal + amount) * 100) / 100;
  }

  return (
    <div className="min-h-screen bg-gradient-app">
      <div className="container mx-auto px-4 py-8">
        <HomeDashboard
          user={{ ...(session.user as UserSession), ...profile }}
          summary={{
            businessName: profile.businessName,
            displayName: profile.name,
            role: profile.role,
            taxRegimeLabel: profile.taxRegime,
            paymentCount,
            pendingCount: pendingStats._count.id,
            pendingTotal: Number(pendingStats._sum.amount ?? 0),
            invoiceCount,
            draftsCount: draftStats._count.id,
            draftsTotal: Number(draftStats._sum.subtotalAmount ?? 0),
            revenueYear,
            annualRevenueTotal,
            annualRevenueCount: annualInvoices.length,
            monthlyRevenue,
          }}
          clients={clients}
          pendingPayments={serializedPendingPayments}
        />
      </div>
    </div>
  );
}
