'use client';

import { useState, useEffect, useRef } from 'react';
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
import { DecryptedClient, InvoiceWithRelations, PaymentWithRelations, INVOICE_STATUS_LABELS } from '@/types';

const paymentSchema = z.object({
  clientId: z.string().min(1, 'Cliente obbligatorio'),
  amount: z.coerce.number().positive('Importo deve essere positivo'),
  currency: z.string().default('EUR'),
  originalAmount: z.coerce.number().positive('Importo deve essere positivo').optional().or(z.literal('')),
  originalCurrency: z.string().optional().or(z.literal('')),
  paidAt: z.string().min(1, 'Data obbligatoria'),
  description: z.string().optional().or(z.literal('')),
  invoiceId: z.string().optional().or(z.literal('')),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface PaymentFormProps {
  clients: DecryptedClient[];
  invoices?: InvoiceWithRelations[];
  defaultClientId?: string;
  payment?: PaymentWithRelations | null;
  onSuccess: () => void;
}

function toDateInput(value: Date | string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return format(new Date(), 'yyyy-MM-dd');
  return format(d, 'yyyy-MM-dd');
}

export function PaymentForm({ clients, invoices = [], defaultClientId, payment, onSuccess }: PaymentFormProps) {
  const isEditing = !!payment;
  const [open, setOpen] = useState(false);

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema) as any,
    defaultValues: payment
      ? {
          clientId: payment.clientId,
          amount: Number(payment.amount),
          currency: payment.currency || 'EUR',
          originalAmount:
            (payment as any).originalAmount === null ||
            (payment as any).originalAmount === undefined
              ? ('' as const)
              : Number((payment as any).originalAmount),
          originalCurrency: (payment as any).originalCurrency || '',
          paidAt: toDateInput(payment.paidAt as unknown as string),
          description: payment.description,
        }
      : {
          clientId: defaultClientId || '',
          amount: 0,
          currency: 'EUR',
          originalAmount: '',
          originalCurrency: '',
          paidAt: format(new Date(), 'yyyy-MM-dd'),
          description: '',
        },
  });

  const selectedClient = clients.find(c => c.id === form.watch('clientId'));
  const showOriginalCurrency = selectedClient?.type === 'EXTRA_EU';

  // Quando i campi vengono compilati programmaticamente (selezione documento),
  // l'effetto di conversione original->EUR deve saltare un giro per non
  // sovrascrivere i valori appena impostati.
  const skipAutoRef = useRef(false);

  const handleClientChange = (clientId: string) => {
    form.setValue('clientId', clientId);
    form.setValue('invoiceId', '');
    // Gli importi eventualmente compilati dal documento precedente non sono più validi.
    form.setValue('amount', 0);
    form.setValue('originalAmount', '' as any);
    const next = clients.find(c => c.id === clientId);
    if (next?.type !== 'EXTRA_EU') {
      form.setValue('originalCurrency', '');
    } else if (!form.getValues('originalCurrency')) {
      // Clienti extra-UE: la valuta originale è di norma il dollaro USA.
      form.setValue('originalCurrency', 'USD');
    }
  };

  // Documenti del cliente selezionato collegabili (tutti tranne i saldati).
  const linkableInvoices = invoices.filter(
    (inv) => inv.clientId === form.watch('clientId') && inv.status !== 'PAID'
  );

  // Quanto resta da saldare sul documento (totale documento meno incassi già collegati).
  const invoiceRemaining = (inv: InvoiceWithRelations): number => {
    const paidSum = (inv.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    return Math.round((Number(inv.totalAmount) - paidSum) * 100) / 100;
  };

  // Compila gli importi dal residuo del documento: l'importo in EUR è immediato
  // (i documenti sono sempre in EUR), quello in valuta originale è ricavato
  // con il cambio Banca d'Italia (verso inverso rispetto all'effetto sopra).
  const fillFromInvoice = async (invoiceId: string) => {
    form.setValue('invoiceId', invoiceId);
    if (!invoiceId) return;
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    const remaining = invoiceRemaining(inv);
    if (!(remaining > 0)) return;
    skipAutoRef.current = true;
    form.setValue('amount', remaining, { shouldValidate: true });
    const selected = clients.find((c) => c.id === form.getValues('clientId'));
    const curr = (form.getValues('originalCurrency') || '').toString().trim().toUpperCase();
    const dateStr = (form.getValues('paidAt') || '').toString();
    if (selected?.type !== 'EXTRA_EU' || !curr || curr === 'EUR' || Number.isNaN(Date.parse(dateStr))) {
      return;
    }
    setRateLoading(true);
    setRateError('');
    try {
      const res = await fetch(
        `/api/exchange-rate?date=${encodeURIComponent(dateStr)}&currency=${encodeURIComponent(curr)}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.error)
            ? data.error.map((e: { message?: string }) => e.message ?? 'Errore cambio').join(', ')
            : data.error || 'Errore cambio'
        );
      }
      const original = Math.round(remaining * data.rate * 100) / 100;
      form.setValue('originalAmount', original, { shouldValidate: true });
      setRateInfo({
        rate: data.rate,
        currency: data.currency,
        referenceDate: data.referenceDate,
        requestedDate: dateStr,
        fallbackUsed: data.fallbackUsed,
        eur: remaining,
      });
    } catch (err) {
      setRateError(err instanceof Error ? err.message : 'Errore cambio');
      setRateInfo(null);
    } finally {
      setRateLoading(false);
    }
  };

  const watchedOriginalAmount = form.watch('originalAmount');
  const watchedOriginalCurrency = form.watch('originalCurrency');
  const watchedPaidAt = form.watch('paidAt');

  const [rateInfo, setRateInfo] = useState<null | {
    rate: number;
    currency: string;
    referenceDate: string;
    requestedDate: string;
    fallbackUsed: boolean;
    eur: number;
  }>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError] = useState('');

  const formatRateDate = (iso: string) => iso.split('-').reverse().join('/');

  useEffect(() => {
    // Salta il giro innescato da una compilazione programmatica (vedi skipAutoRef).
    if (skipAutoRef.current) {
      skipAutoRef.current = false;
      return;
    }
    const rawOrig = watchedOriginalAmount as unknown;
    const orig = typeof rawOrig === 'number' ? rawOrig : Number(rawOrig);
    const curr = ((watchedOriginalCurrency as unknown) || '').toString().trim().toUpperCase();
    const dateStr = ((watchedPaidAt as unknown) || '').toString();
    if (
      !showOriginalCurrency ||
      !(orig > 0) ||
      !/^[A-Z]{3}$/.test(curr) ||
      curr === 'EUR' ||
      Number.isNaN(Date.parse(dateStr))
    ) {
      setRateInfo(null);
      setRateError('');
      setRateLoading(false);
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    setRateError('');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/exchange-rate?date=${encodeURIComponent(dateStr)}&currency=${encodeURIComponent(curr)}&amount=${encodeURIComponent(String(orig))}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            Array.isArray(data.error)
              ? data.error.map((e: any) => e.message).join(', ')
              : data.error || 'Errore cambio'
          );
        }
        setRateInfo({
          rate: data.rate,
          currency: data.currency,
          referenceDate: data.referenceDate,
          requestedDate: data.requestedDate,
          fallbackUsed: data.fallbackUsed,
          eur: data.eurAmount,
        });
        form.setValue('amount', data.eurAmount, { shouldValidate: true });
      } catch (err) {
        if (!cancelled) {
          setRateError(err instanceof Error ? err.message : 'Errore cambio');
          setRateInfo(null);
        }
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [watchedOriginalAmount, watchedOriginalCurrency, watchedPaidAt, showOriginalCurrency]);

  const onSubmit = async (data: PaymentFormData) => {
    try {
      const isExtraEu = clients.find(c => c.id === data.clientId)?.type === 'EXTRA_EU';
      const rawOriginal = (data as any).originalAmount;
      const originalAmount =
        !isExtraEu || rawOriginal === '' || rawOriginal === null || rawOriginal === undefined
          ? undefined
          : Number(rawOriginal);
      const rawCurrency = ((data as any).originalCurrency || '').toString().trim().toUpperCase();
      // Descrizione facoltativa: se vuota diventa "Accredito" qui, mai nel value HTML.
      const description = ((data as any).description || '').toString().trim() || 'Accredito';
      const rawInvoiceId = ((data as any).invoiceId || '').toString().trim();
      const payload = {
        ...data,
        description,
        originalAmount,
        originalCurrency: originalAmount !== undefined && rawCurrency ? rawCurrency : undefined,
        invoiceId: !isEditing && rawInvoiceId ? rawInvoiceId : undefined,
      };
      const url = isEditing && payment ? `/api/payments/${payment.id}` : '/api/payments';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        const message = Array.isArray(error.error)
          ? error.error.map((e: any) => e.message).join(', ')
          : error.error || 'Errore salvataggio';
        throw new Error(message);
      }

      onSuccess();
      form.reset({ clientId: '', amount: 0, currency: 'EUR', originalAmount: '', originalCurrency: '', paidAt: format(new Date(), 'yyyy-MM-dd'), description: '' });
      setOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore sconosciuto');
    }
  };

  if (isEditing) {
    return (
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
        {payment?.invoiceId && (
          <p className="text-sm text-muted-foreground">
            Questo incasso è collegato a un documento: la modifica ricalcolerà lo stato del documento.
          </p>
        )}
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

        {showOriginalCurrency && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="originalAmount">Importo valuta originale</Label>
              <Input
                id="originalAmount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="es. 454.26"
                {...form.register('originalAmount')}
              />
              {form.formState.errors.originalAmount && (
                <p className="text-sm text-red-500">{form.formState.errors.originalAmount.message as string}</p>
              )}
            </div>
          <div>
            <Label htmlFor="originalCurrency">Valuta originale</Label>
            <Select
              value={form.watch('originalCurrency') || ''}
              onValueChange={(v) => form.setValue('originalCurrency', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleziona valuta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD - Dollaro USA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
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
            {rateLoading && (
              <p className="text-sm text-muted-foreground">Calcolo cambio Banca d'Italia…</p>
            )}
            {rateError && (
              <p className="text-sm text-red-500">{rateError}</p>
            )}
            {rateInfo && (
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  Cambio BdI del {formatRateDate(rateInfo.referenceDate)}: 1 € = {rateInfo.rate} {rateInfo.currency}
                  {rateInfo.fallbackUsed && ` (ultima quotazione prima del ${formatRateDate(rateInfo.requestedDate)})`}
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="description">Descrizione</Label>
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
          <Button type="button" variant="outline" onClick={() => onSuccess()}>
            Annulla
          </Button>
          <Button type="submit">Salva</Button>
        </div>
      </form>
    );
  }

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
            <Label htmlFor="invoiceId">Collega a documento (facoltativo)</Label>
            <Select
              value={form.watch('invoiceId') || '__none'}
              onValueChange={(v) => fillFromInvoice(v === '__none' ? '' : v)}
              disabled={!form.watch('clientId')}
            >
              <SelectTrigger>
                <SelectValue placeholder="Nessuno (lascia pendente)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Nessuno (lascia pendente)</SelectItem>
                {linkableInvoices.map((inv) => (
                  <SelectItem key={inv.id} value={inv.id}>
                    N. {inv.number}/{inv.year} — {INVOICE_STATUS_LABELS[inv.status]} (residuo {invoiceRemaining(inv).toFixed(2)} €)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.watch('clientId') && linkableInvoices.length === 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                Nessun documento non saldato per questo cliente.
              </p>
            )}
          </div>

          {showOriginalCurrency && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="originalAmount">Importo valuta originale</Label>
                <Input
                  id="originalAmount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="es. 454.26"
                  {...form.register('originalAmount')}
                />
                {form.formState.errors.originalAmount && (
                  <p className="text-sm text-red-500">{form.formState.errors.originalAmount.message as string}</p>
                )}
              </div>
              <div>
                <Label htmlFor="originalCurrency">Valuta originale</Label>
                <Select
                  value={form.watch('originalCurrency') || ''}
                  onValueChange={(v) => form.setValue('originalCurrency', v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona valuta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD - Dollaro USA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
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
              {rateLoading && (
                <p className="text-sm text-muted-foreground">Calcolo cambio Banca d'Italia…</p>
              )}
              {rateError && (
                <p className="text-sm text-red-500">{rateError}</p>
              )}
              {rateInfo && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    Cambio BdI del {formatRateDate(rateInfo.referenceDate)}: 1 € = {rateInfo.rate} {rateInfo.currency}
                    {rateInfo.fallbackUsed && ` (ultima quotazione prima del ${formatRateDate(rateInfo.requestedDate)})`}
                  </p>
                </div>
              )}
            </div>
          </div>

        <div>
          <Label htmlFor="description">Descrizione</Label>
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