'use client';

import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableHeader, TableRow, TableCell, TableBody } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { PaymentWithRelations, DecryptedClient, InvoiceWithRelations, InvoiceStatus, INVOICE_STATUS_LABELS } from '@/types';
import { formatDualAmountShort } from '@/lib/tax';

const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Descrizione obbligatoria'),
  amount: z.coerce.number().positive('Importo deve essere positivo'),
});

const invoiceEditSchema = z.object({
  clientId: z.string().min(1, 'Cliente obbligatorio'),
  date: z.string().min(1, 'Data obbligatoria'),
  paymentIds: z.array(z.string()).min(1, 'Seleziona almeno un incasso'),
  items: z.array(invoiceItemSchema).min(1, 'Almeno una riga fattura'),
  status: z.enum(['ISSUED', 'PAID', 'PARTIALLY_PAID', 'CANCELLED']),
});

type InvoiceEditFormData = z.infer<typeof invoiceEditSchema>;

interface InvoiceEditFormProps {
  invoice: InvoiceWithRelations;
  clients: DecryptedClient[];
  pendingPayments: PaymentWithRelations[];
  onSuccess: () => void;
}

function toDateInput(value: Date | string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return format(new Date(), 'yyyy-MM-dd');
  return format(d, 'yyyy-MM-dd');
}

export function InvoiceEditForm({ invoice, clients, pendingPayments, onSuccess }: InvoiceEditFormProps) {
  const [selectedClientId, setSelectedClientId] = useState(invoice.clientId);

  const form = useForm<InvoiceEditFormData>({
    resolver: zodResolver(invoiceEditSchema) as any,
    defaultValues: {
      clientId: invoice.clientId,
      date: toDateInput(invoice.date),
      paymentIds: invoice.payments.map(p => p.id),
      items: invoice.items.map(it => ({ description: it.description, amount: Number(it.amount) as number })),
      status: invoice.status,
    },
  });

  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  // Incassi selezionabili: pendenti del cliente + quelli già collegati a questa fattura.
  const linkedIds = new Set(invoice.payments.map(p => p.id));
  const clientPayments = [
    ...pendingPayments.filter(p => p.clientId === form.watch('clientId')),
    ...invoice.payments.filter(p => p.clientId === form.watch('clientId') && !pendingPayments.some(pp => pp.id === p.id)),
  ];
  const selectedPayments = form.watch('paymentIds');
  const watchedItems = form.watch('items');
  const displayClientType = clients.find(c => c.id === form.watch('clientId'))?.type ?? invoice.client.type;
  const paymentsTotal = clientPayments
    .filter(p => selectedPayments.includes(p.id))
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const linesTotal = (watchedItems || []).reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
  const totalsMismatch = Math.abs(linesTotal - paymentsTotal) >= 0.005;

  // Con una sola riga, l'importo segue in automatico il totale degli incassi selezionati.
  useEffect(() => {
    if (itemFields.length === 1) {
      form.setValue('items.0.amount', Math.round(paymentsTotal * 100) / 100, { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentsTotal, itemFields.length]);

  const onSubmit = async (data: InvoiceEditFormData) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        const message = Array.isArray(error.error)
          ? error.error.map((e: any) => e.message).join(', ')
          : error.error || 'Errore modifica fattura';
        throw new Error(message);
      }

      onSuccess();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore sconosciuto');
    }
  };

  const handleClientChange = (clientId: string) => {
    form.setValue('clientId', clientId);
    form.setValue('paymentIds', []);
    setSelectedClientId(clientId);
  };

  const togglePayment = (paymentId: string) => {
    const current = form.getValues('paymentIds');
    if (current.includes(paymentId)) {
      form.setValue('paymentIds', current.filter(id => id !== paymentId));
    } else {
      form.setValue('paymentIds', [...current, paymentId]);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
      {invoice.status === 'ISSUED' && (
        <div className="alert-box alert-warning">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Attenzione: fattura già emessa (N. {invoice.number}/{invoice.year}).
            La modifica non è bloccante, ma verifica con attenzione i dati prima di salvare.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="clientId">Cliente *</Label>
          <Select value={form.watch('clientId')} onValueChange={handleClientChange} required>
            <SelectTrigger>
              <SelectValue placeholder="Seleziona cliente" />
            </SelectTrigger>
            <SelectContent>
              {clients.map(client => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name} ({client.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.clientId && (
            <p className="text-sm text-red-500">{form.formState.errors.clientId.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="status">Stato</Label>
          <Select
            value={form.watch('status')}
            onValueChange={(v) => form.setValue('status', v as InvoiceStatus)}
            required
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(INVOICE_STATUS_LABELS) as InvoiceStatus[]).map(s => (
                <SelectItem key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="date">Data Fattura *</Label>
        <Input
          id="date"
          type="date"
          {...form.register('date')}
        />
        {form.formState.errors.date && (
          <p className="text-sm text-red-500">{form.formState.errors.date.message}</p>
        )}
      </div>

      {selectedClientId && clientPayments.length > 0 && (
        <div className="space-y-2">
          <Label className="font-medium">Incassi da includere (Totale: {paymentsTotal.toFixed(2)} EUR)</Label>
          <div className="border rounded-lg p-2 max-h-60 overflow-y-auto">
            {clientPayments.map(payment => (
              <label key={payment.id} className="payment-option p-2">
                <Checkbox
                  checked={selectedPayments.includes(payment.id)}
                  onCheckedChange={() => togglePayment(payment.id)}
                />
                <div className="flex-1">
                  <p className="font-medium">{payment.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(payment.paidAt), 'dd/MM/yyyy')} - {formatDualAmountShort(payment.amount, (payment as any).originalAmount, (payment as any).originalCurrency, displayClientType)}
                    {linkedIds.has(payment.id) ? ' • già in fattura' : ''}
                  </p>
                </div>
              </label>
            ))}
          </div>
          {form.formState.errors.paymentIds && (
            <p className="text-sm text-red-500">{form.formState.errors.paymentIds.message}</p>
          )}
        </div>
      )}

      {selectedClientId && clientPayments.length === 0 && (
        <p className="warning-text">Nessun incasso disponibile per questo cliente</p>
      )}

      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <Label className="font-medium">Righe Fattura</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => appendItem({ description: '', amount: 0 })}
          >
            <Plus className="w-4 h-4 mr-1" /> Aggiungi riga
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell className="w-[60%]">Descrizione</TableCell>
              <TableCell className="w-[20%]">Importo</TableCell>
              <TableCell className="w-[10%]">Azioni</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itemFields.map((field, index) => (
              <TableRow key={field.id}>
                    <TableCell>
                      <Input
                        placeholder="Descrizione prestazione"
                        {...form.register(`items.${index}.description`)}
                        className="w-full"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        {...form.register(`items.${index}.amount`, { valueAsNumber: true })}
                        className="w-full text-right"
                      />
                    </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeItem(index)}
                    disabled={itemFields.length === 1}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
            {form.formState.errors.items && (
              <p className="text-sm text-red-500 mt-2">
                {(form.formState.errors.items as any)?.message || 'Verifica descrizioni e importi delle righe.'}
              </p>
            )}
      </div>

      <div className="flex justify-end gap-6 pt-2 text-sm">
        <span>Totale incassi: <strong>{paymentsTotal.toFixed(2)} €</strong></span>
        <span>Totale righe: <strong className={totalsMismatch ? 'text-red-500' : ''}>{linesTotal.toFixed(2)} €</strong></span>
      </div>
      {totalsMismatch && selectedPayments.length > 0 && (
        <p className="text-sm text-red-500 text-right">Il totale delle righe deve corrispondere al totale degli incassi selezionati.</p>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={() => onSuccess()}>
          Annulla
        </Button>
        <Button type="submit" disabled={selectedPayments.length === 0 || itemFields.length === 0 || totalsMismatch}>
          Salva Modifiche
        </Button>
      </div>
    </form>
  );
}

export function InvoiceEditDialog({
  invoice,
  clients,
  pendingPayments,
  onSuccess,
  documentKind = 'fattura',
}: InvoiceEditFormProps & { invoice: InvoiceWithRelations; documentKind?: 'fattura' | 'ricevuta' }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Modifica {documentKind === 'ricevuta' ? 'Ricevuta' : 'Fattura'} {invoice.number}/{invoice.year}
        </DialogTitle>
      </DialogHeader>
      <InvoiceEditForm
        invoice={invoice}
        clients={clients}
        pendingPayments={pendingPayments}
        onSuccess={onSuccess}
      />
    </>
  );
}
