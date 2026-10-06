'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableHeader, TableRow, TableCell, TableBody } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { Plus, Trash2, X } from 'lucide-react';
import { PaymentWithRelations, Client } from '@/types';

const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Descrizione obbligatoria'),
  amount: z.coerce.number().positive('Importo deve essere positivo'),
});

const invoiceSchema = z.object({
  clientId: z.string().min(1, 'Cliente obbligatorio'),
  date: z.string().min(1, 'Data obbligatoria'),
  paymentIds: z.array(z.string()).min(1, 'Seleziona almeno un incasso'),
  items: z.array(invoiceItemSchema).min(1, 'Almeno una riga fattura'),
});

type InvoiceFormData = z.infer<typeof invoiceSchema>;

interface InvoiceFormProps {
  clients: Client[];
  pendingPayments: PaymentWithRelations[];
  onSuccess: () => void;
}

export function InvoiceForm({ clients, pendingPayments, onSuccess }: InvoiceFormProps) {
  const [open, setOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');

  const form = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema) as any,
    defaultValues: {
      clientId: '',
      date: format(new Date(), 'yyyy-MM-dd'),
      paymentIds: [] as string[],
      items: [{ description: '', amount: 0 as number }],
    },
  });

  const { fields: itemFields, append: appendItem, remove: removeItem } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const clientPayments = pendingPayments.filter(p => p.clientId === form.watch('clientId'));
  const selectedPayments = form.watch('paymentIds');
  const totalAmount = clientPayments
    .filter(p => selectedPayments.includes(p.id))
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const onSubmit = async (data: InvoiceFormData) => {
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || 'Errore creazione fattura');
      }

      onSuccess();
      form.reset({ clientId: '', date: format(new Date(), 'yyyy-MM-dd'), paymentIds: [] as string[], items: [{ description: '', amount: 0 as number }] });
      setSelectedClientId('');
      setOpen(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto" disabled={pendingPayments.length === 0}>
          <span className="flex items-center gap-2">Nuova Fattura</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Genera Fattura Cumulativa</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
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
              <Label className="font-medium">Incassi da includere (Totale: {totalAmount.toFixed(2)} EUR)</Label>
              <div className="border rounded-lg p-2 max-h-60 overflow-y-auto">
                {clientPayments.map(payment => (
                  <label key={payment.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer">
                    <Checkbox
                      checked={selectedPayments.includes(payment.id)}
                      onCheckedChange={() => togglePayment(payment.id)}
                    />
                    <div className="flex-1">
                      <p className="font-medium">{payment.description}</p>
                      <p className="text-sm text-gray-500">
                        {format(new Date(payment.paidAt), 'dd/MM/yyyy')} - {Number(payment.amount).toFixed(2)} EUR
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
            <p className="text-sm text-yellow-600">Nessun incasso pendente per questo cliente</p>
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
                      {form.formState.errors.items?.[index]?.description && (
                        <p className="text-sm text-red-500">{form.formState.errors.items[index].description.message}</p>
                      )}
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
                      {form.formState.errors.items?.[index]?.amount && (
                        <p className="text-sm text-red-500">{form.formState.errors.items[index].amount.message}</p>
                      )}
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
              <p className="text-sm text-red-500 mt-2">{form.formState.errors.items.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit" disabled={selectedPayments.length === 0 || itemFields.length === 0}>
              Genera Fattura
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}