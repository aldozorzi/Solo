import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HomeDashboard from "@/components/HomeDashboard";
import type { UserSession } from "@/types";
import { getUserDek, decryptClient, decryptPayment, decryptInvoice } from "@/lib/data-encryption";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as UserSession).id;
  const dek = await getUserDek(userId).catch(() => null);
  if (!dek) {
    // Sessione presente ma DEK non disponibile (es. cookie scaduto in modalità
    // Zero-Knowledge): forziamo un nuovo login invece di crashare.
    redirect("/login?error=SessionExpired");
  }
  const revenueYear = new Date().getFullYear();
  const revenueStart = new Date(Date.UTC(revenueYear, 0, 1));
  const revenueEnd = new Date(Date.UTC(revenueYear + 1, 0, 1));
  const [profile, pendingStored, paymentCount, draftStored, invoiceCount, issuedPaidStored, clientsStored] =
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
        // paidAt è cifrato: ordinamento su createdAt (plaintext).
        orderBy: { createdAt: "desc" },
      }),
      prisma.payment.count({ where: { userId } }),
      prisma.invoice.findMany({
        where: { userId, status: "DRAFT" },
      }),
      prisma.invoice.count({ where: { userId } }),
      // Filtro data in JS: date è cifrata, non interrogabile in SQL.
      prisma.invoice.findMany({
        where: { userId, status: { in: ["ISSUED", "PAID"] } },
      }),
      prisma.client.findMany({
        where: { userId },
        // name è cifrato: ordinamento in JS dopo la decifratura.
      }),
    ]);

  if (!profile) {
    redirect("/login");
  }

  // Decifratura + aggregati in JS (i campi sensibili non sono aggregabili in SQL).
  const pendingDecrypted = await Promise.all(
    pendingStored.map(async (p) => {
      const payment = await decryptPayment(p, dek);
      payment.client = await decryptClient(p.client, dek);
      return payment;
    })
  );
  const pendingTotal = Math.round(pendingDecrypted.reduce((s, p) => s + p.amount, 0) * 100) / 100;

  const draftDecrypted = await Promise.all(draftStored.map((i) => decryptInvoice(i, dek)));
  const draftsTotal =
    Math.round(draftDecrypted.reduce((s, i) => s + i.subtotalAmount, 0) * 100) / 100;

  const annualDecrypted = await Promise.all(issuedPaidStored.map((i) => decryptInvoice(i, dek)));
  const annualInvoices = annualDecrypted.filter((i) => i.date >= revenueStart && i.date < revenueEnd);

  const clientsDecrypted = await Promise.all(clientsStored.map((c) => decryptClient(c, dek)));
  clientsDecrypted.sort((a, b) => a.name.localeCompare(b.name, "it"));

  const serializedPendingPayments = pendingDecrypted.map((payment) => ({
    id: payment.id,
    clientId: payment.clientId,
    description: payment.description,
    amount: payment.amount,
    paidAt: payment.paidAt.toISOString(),
    // Sempre valorizzato: il client è incluso nella query e decifrato sopra.
    client: payment.client!,
  }));

  const monthLabels = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const monthlyRevenue = monthLabels.map((label, month) => ({ month, label, total: 0, count: 0 }));
  let annualRevenueTotal = 0;
  for (const invoice of annualInvoices) {
    const amount = invoice.totalAmount;
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
            pendingCount: pendingDecrypted.length,
            pendingTotal,
            invoiceCount,
            draftsCount: draftDecrypted.length,
            draftsTotal,
            revenueYear,
            annualRevenueTotal,
            annualRevenueCount: annualInvoices.length,
            monthlyRevenue,
          }}
          clients={clientsDecrypted}
          pendingPayments={serializedPendingPayments}
        />
      </div>
    </div>
  );
}
