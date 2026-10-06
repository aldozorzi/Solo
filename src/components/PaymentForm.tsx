'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { Client } from '@/types';

const paymentSchema = z.object({
  clientId: z.string().min(1, 'Cliente obbligatorio'),
  amount: z.coerce.number().positive('Importo deve essere positivo'),
  currency: z.string().default('EUR'),
  paidAt: z.string().min(1, 'Data obbligatoria'),
  description: z.string().min(1, 'Descrizione obbligatoria'),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface PaymentFormProps {
  clients: Client[];
  defaultClientId?: string;
  onSuccess: () => void;
}

export function PaymentForm({ clients, defaultClientId, onSuccess }: PaymentFormProps) {
  const [open, setOpen] = useState(false);

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema) as any,
    defaultValues: {
      clientId: defaultClientId || '',
      amount: 0,
      currency: 'EUR',
      paidAt: format(new Date(), 'yyyy-MM-dd'),
      description: '',
    },
  });

  const onSubmit = async (data: PaymentFormData) => {
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || 'Errore salvataggio');
      }

      onSuccess();
      form.reset({ clientId: '', amount: 0, currency: 'EUR', paidAt: format(new Date(), 'yyyy-MM-dd'), description: '' });
      setOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore sconosciuto');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">
          <span className="flex items-center gap-2">Nuovo Incasso</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Registra Incasso</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
          <div>
            <Label htmlFor="clientId">Cliente *</Label>
            <Select value={form.watch('clientId')} onValueChange={v => form.setValue('clientId', v)} required>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="amount">Importo (EUR) *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                {...form.register('amount', { valueAsNumber: true })}
              />
              {form.formState.errors.amount && (
                <p className="text-sm text-red-500">{form.formState.errors.amount.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="paidAt">Data Incasso *</Label>
              <Input
                id="paidAt"
                type="date"
                {...form.register('paidAt')}
              />
              {form.formState.errors.paidAt && (
                <p className="text-sm text-red-500">{form.formState.errors.paidAt.message}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="description">Descrizione *</Label>
            <Textarea
              id="description"
              {...form.register('description')}
              rows={3}
              placeholder="Descrizione della prestazione..."
            />
            {form.formState.errors.description && (
              <p className="text-sm text-red-500">{form.formState.errors.description.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit">Registra</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}