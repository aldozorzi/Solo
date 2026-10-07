'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, FileText, Trash2, Edit, Plus, Settings, Users, UserPlus, Shield, LogOut, User } from 'lucide-react';
import { ClientForm } from './ClientForm';
import { PaymentForm } from './PaymentForm';
import { InvoiceForm } from './InvoiceForm';
import { InvoiceEditDialog } from './InvoiceEditForm';
import { MainNav } from './MainNav';
import { ThemeSelector } from './ThemeSelector';
import { calculateInvoiceTotals } from '@/lib/tax';
import { SettingsForm } from './SettingsForm';
import { UserManagement } from './UserManagement';
import { Client, PaymentWithRelations, InvoiceWithRelations, InvoiceStatus, INVOICE_STATUS_LABELS, INVOICE_STATUS_COLORS, CLIENT_TYPE_LABELS, UserRole, USER_ROLE_LABELS, TAX_REGIME_LABELS, UserSession } from '@/types';
import { Toaster } from '@/components/ui/sonner';
import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { formatDualAmountShort } from '@/lib/tax';

type TabValue = 'payments' | 'invoices' | 'clients' | 'settings' | 'users';

export default function Dashboard({ initialSection = 'payments' }: { initialSection?: TabValue }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [clients, setClients] = useState<Client[]>([]);
  const [payments, setPayments] = useState<PaymentWithRelations[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [pendingPayments, setPendingPayments] = useState<PaymentWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab] = useState<TabValue>(initialSection);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingPayment, setEditingPayment] = useState<PaymentWithRelations | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceWithRelations | null>(null);

  const user = session?.user as UserSession | undefined;
  const isAdmin = user?.role === 'ADMIN';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [clientsRes, paymentsRes, invoicesRes, pendingRes] = await Promise.all([
        fetch('/api/clients'),
        fetch('/api/payments'),
        fetch('/api/invoices'),
        fetch('/api/payments?withoutInvoice=true'),
      ]);

      const [clientsData, paymentsData, invoicesData, pendingData] = await Promise.all([
        clientsRes.json(),
        paymentsRes.json(),
        invoicesRes.json(),
        pendingRes.json(),
      ]);

      setClients(clientsData);
      setPayments(paymentsData);
      setInvoices(invoicesData);
      setPendingPayments(pendingData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (status === 'authenticated') {
      fetchData();
    }
  }, [status]);

  const handleSuccess = () => {
    fetchData();
    setEditingClient(null);
    setEditingPayment(null);
    setEditingInvoice(null);
  };

  const deletePayment = async (paymentId: string) => {
    if (!confirm("Eliminare questo incasso? L'azione non è reversibile.")) return;
    try {
      const res = await fetch(`/api/payments/${paymentId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        const error = await res.json();
        alert(error.error || 'Errore eliminazione');
      }
    } catch (error) {
      console.error('Error deleting payment:', error);
      alert('Errore eliminazione');
    }
  };

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
    router.push('/login');
  };

  const downloadXml = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}?format=xml`);
      if (!res.ok) throw new Error('Errore download XML');
      const blob = await res.blob();
      // Il nome file SdI (IT<PIVA>_<progressivo>.xml) è generato dal server in
      // Content-Disposition: va preservato, non sovrascritto lato client.
      const disposition = res.headers.get('Content-Disposition') || '';
      const fileNameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const fileName = fileNameMatch?.[1] ?? `IT_${invoiceId}.xml`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      // L'esportazione XML può aver aggiornato lo stato: ricarica i dati.
      fetchData();
    } catch (error) {
      console.error('Error downloading XML:', error);
      alert('Errore download XML');
    }
  };

  const openPdf = (invoiceId: string) => {
    // Navigazione diretta: il browser apre il PDF nel visualizzatore
    // usando il filename dall'header Content-Disposition.
    window.open(`/api/invoices/${invoiceId}?format=pdf`, '_blank', 'noopener,noreferrer');
  };

  const deleteInvoice = async (invoiceId: string) => {
    if (!confirm('Eliminare questa fattura? L\'azione non è reversibile.')) return;
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        alert('Errore eliminazione');
      }
    } catch (error) {
      console.error('Error deleting invoice:', error);
      alert('Errore eliminazione');
    }
  };

  const deleteClient = async (clientId: string) => {
    if (!confirm('Eliminare questo cliente? Verranno eliminati anche i pagamenti e le fatture associate.')) return;
    try {
      const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        alert('Errore eliminazione');
      }
    } catch (error) {
      console.error('Error deleting client:', error);
      alert('Errore eliminazione');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Solo - Gestionale Fatture</h1>
          <div className="text-sm text-muted-foreground">
            {user?.businessName} • {USER_ROLE_LABELS[user?.role || 'USER']} • {TAX_REGIME_LABELS[user?.taxRegime || 'FORFETTARIO']}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <ThemeSelector />
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSignOut} title="Esci">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
          <div className="w-px h-6 bg-border" />
          <span className="text-sm text-muted-foreground">{user?.name}</span>
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} className="space-y-4">
        <MainNav
          isAdmin={isAdmin}
          counts={{
            payments: pendingPayments.length,
            invoices: invoices.length,
            clients: clients.length,
          }}
        />

        <TabsContent value="payments">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Registro Incassi</h2>
            <PaymentForm clients={clients} onSuccess={handleSuccess} />
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Importo</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="w-40">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nessun incasso registrato
                      </TableCell>
                    </TableRow>
                  ) : (
                    payments.map(payment => (
                      <TableRow key={payment.id}>
                        <TableCell>{format(new Date(payment.paidAt), 'dd/MM/yyyy')}</TableCell>
                        <TableCell className="font-medium">{payment.client.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {CLIENT_TYPE_LABELS[payment.client.type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="dashboard-amount text-right font-mono tabular-nums">
                          {formatDualAmountShort(payment.amount, (payment as any).originalAmount, (payment as any).originalCurrency, payment.client.type)}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">{payment.description}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {payment.invoiceId ? 'Fatturato' : 'Pendente'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {!payment.invoiceId ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setEditingPayment(payment)}
                                  title="Modifica incasso"
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => deletePayment(payment.id)}
                                  title="Elimina incasso"
                                >
                                  <Trash2 className="w-4 h-4 text-red-500" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => downloadXml(payment.invoiceId as string)}
                                  title="Scarica fattura XML"
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openPdf(payment.invoiceId as string)}
                                  title="Apri fattura PDF"
                                >
                                  <FileText className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Fatture Emesse</h2>
            <InvoiceForm clients={clients} pendingPayments={pendingPayments} onSuccess={handleSuccess} />
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Numero</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Imponibile</TableHead>
                    <TableHead className="text-right">Totale</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="w-44">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Nessuna fattura emessa
                      </TableCell>
                    </TableRow>
                  ) : (
                    invoices.map(invoice => {
                      const displayTotals = calculateInvoiceTotals({
                        subtotal: Number(invoice.subtotalAmount),
                        clientType: invoice.client.type,
                        taxRegime: user?.taxRegime || 'FORFETTARIO',
                        senderType: user?.senderType || 'LIBERO_PROFESSIONISTA',
                      });
                      const displayTotal = displayTotals.subtotal + displayTotals.vatAmount;
                      return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-mono font-medium">
                          {invoice.number}/{invoice.year}
                        </TableCell>
                        <TableCell>{format(new Date(invoice.date), 'dd/MM/yyyy')}</TableCell>
                        <TableCell className="font-medium">{invoice.client.name}</TableCell>
                        <TableCell className="dashboard-amount text-right font-mono tabular-nums">
                          {Number(invoice.subtotalAmount).toFixed(2)} EUR
                        </TableCell>
                        <TableCell className="dashboard-amount text-right font-mono tabular-nums font-semibold">
                          {displayTotal.toFixed(2)} EUR
                        </TableCell>
                        <TableCell>
                          <Badge className={INVOICE_STATUS_COLORS[invoice.status]}>
                            {INVOICE_STATUS_LABELS[invoice.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingInvoice(invoice)}
                              title="Modifica"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => downloadXml(invoice.id)} title="Scarica XML SdI">
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => openPdf(invoice.id)} title="Apri PDF">
                              <FileText className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteInvoice(invoice.id)} title="Elimina">
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clients">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Anagrafica Clienti</h2>
            <ClientForm onSuccess={handleSuccess} />
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>P.IVA / Tax ID</TableHead>
                    <TableHead>Codice SDI</TableHead>
                    <TableHead>Indirizzo</TableHead>
                    <TableHead>Incassi</TableHead>
                    <TableHead>Fatture</TableHead>
                    <TableHead className="w-24">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Nessun cliente registrato
                      </TableCell>
                    </TableRow>
                  ) : (
                    clients.map(client => (
                      <TableRow key={client.id}>
                        <TableCell className="font-medium">{client.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {CLIENT_TYPE_LABELS[client.type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{client.vatNumber || '-'}</TableCell>
                        <TableCell className="font-mono text-sm">{client.sdiCode || '-'}</TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">
                          {client.address || '-'}
                          {client.city && `, ${client.city}`}
                          {client.zipCode && ` ${client.zipCode}`}
                        </TableCell>
                        <TableCell>{(client as any)._count?.payments || 0}</TableCell>
                        <TableCell>{(client as any)._count?.invoices || 0}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingClient(client)}
                              title="Modifica"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteClient(client.id)}
                              title="Elimina"
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <div className="max-w-2xl mx-auto">
            <SettingsForm onSettingsChange={handleSuccess} />
          </div>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users">
            <UserManagement onRefresh={handleSuccess} />
          </TabsContent>
        )}
      </Tabs>

      <Dialog open={!!editingInvoice} onOpenChange={(v) => { if (!v) setEditingInvoice(null); }}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
          {editingInvoice && (
            <InvoiceEditDialog
              invoice={editingInvoice}
              clients={clients}
              pendingPayments={pendingPayments}
              onSuccess={handleSuccess}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingPayment} onOpenChange={(v) => { if (!v) setEditingPayment(null); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Modifica Incasso</DialogTitle>
          </DialogHeader>
          {editingPayment && (
            <PaymentForm
              key={editingPayment.id}
              clients={clients}
              payment={editingPayment}
              onSuccess={handleSuccess}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingClient} onOpenChange={(v) => { if (!v) setEditingClient(null); }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingClient ? 'Modifica Cliente' : 'Nuovo Cliente'}</DialogTitle>
          </DialogHeader>
          {editingClient && (
            <ClientForm
              key={editingClient.id}
              client={editingClient}
              onSuccess={handleSuccess}
            />
          )}
        </DialogContent>
      </Dialog>

      <Toaster position="bottom-right" />
    </div>
  );
}