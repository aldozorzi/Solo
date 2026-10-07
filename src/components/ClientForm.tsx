'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import { ClientType, CLIENT_TYPE_LABELS, CLIENT_TYPE_SDI_DEFAULTS } from '@/types';

const clientSchema = z.object({
  name: z.string().min(1, 'Nome obbligatorio'),
  type: z.enum(['ITALY', 'EU', 'EXTRA_EU']),
  vatNumber: z.string().optional(),
  taxCode: z.string().optional(),
  sdiCode: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  zipCode: z.string().optional(),
  country: z.string().default('US'),
});

type ClientFormData = z.infer<typeof clientSchema>;

interface ClientFormProps {
  client?: {
    id: string;
    name: string;
    type: ClientType;
    vatNumber: string | null;
    taxCode: string | null;
    sdiCode: string | null;
    address: string | null;
    city: string | null;
    zipCode: string | null;
    country: string;
  } | null;
  onSuccess: () => void;
}

export function ClientForm({ client, onSuccess }: ClientFormProps) {
  const isEditing = !!client;
  const [open, setOpen] = useState(false);

  const form = useForm<ClientFormData>({
    resolver: zodResolver(clientSchema) as any,
    defaultValues: {
      name: client?.name || '',
      type: client?.type || 'EXTRA_EU',
      vatNumber: client?.vatNumber || '',
      taxCode: client?.taxCode || '',
      sdiCode: client?.sdiCode || '',
      address: client?.address || '',
      city: client?.city || '',
      zipCode: client?.zipCode || '',
      country: client?.country || 'US',
    },
  });

  const onSubmit = async (data: ClientFormData) => {
    try {
      const defaults = CLIENT_TYPE_SDI_DEFAULTS[data.type];
      const payload = {
        ...data,
        sdiCode: data.sdiCode || defaults.sdiCode,
        zipCode: data.zipCode || defaults.zipCode,
        country: data.country || (data.type === 'ITALY' ? 'IT' : 'US'),
      };

      const url = isEditing ? `/api/clients/${client.id}` : '/api/clients';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || 'Errore salvataggio');
      }

      onSuccess();
      form.reset({ name: '', type: 'EXTRA_EU', vatNumber: '', taxCode: '', sdiCode: '', address: '', city: '', zipCode: '', country: 'US' });
      setOpen(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore sconosciuto');
    }
  };

  const handleTypeChange = (type: ClientType) => {
    form.setValue('type', type);
    const defaults = CLIENT_TYPE_SDI_DEFAULTS[type];
    if (defaults) {
      form.setValue('sdiCode', defaults.sdiCode);
      form.setValue('zipCode', defaults.zipCode);
      form.setValue('country', type === 'ITALY' ? 'IT' : 'US');
    }
  };

  if (isEditing) {
    return (
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">Nome *</Label>
            <Input id="name" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
            )}
          </div>
          <div>
            <Label htmlFor="type">Tipo Cliente *</Label>
            <Select value={form.watch('type')} onValueChange={handleTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value as ClientType}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="vatNumber">Partita IVA / Tax ID</Label>
            <Input id="vatNumber" {...form.register('vatNumber')} />
          </div>
          <div>
            <Label htmlFor="taxCode">Codice Fiscale</Label>
            <Input id="taxCode" {...form.register('taxCode')} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="sdiCode">Codice SDI</Label>
            <Input id="sdiCode" {...form.register('sdiCode')} />
          </div>
          <div>
            <Label htmlFor="country">Nazione (ISO)</Label>
            <Input id="country" {...form.register('country')} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="address">Indirizzo</Label>
            <Input id="address" {...form.register('address')} />
          </div>
          <div>
            <Label htmlFor="city">Città</Label>
            <Input id="city" {...form.register('city')} />
          </div>
        </div>

        <div>
          <Label htmlFor="zipCode">CAP</Label>
          <Input id="zipCode" {...form.register('zipCode')} />
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={() => onSuccess()}>
            Annulla
          </Button>
          <Button type="submit">{isEditing ? 'Salva' : 'Crea Cliente'}</Button>
        </div>
      </form>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">
          <span className="flex items-center gap-2">Nuovo Cliente</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Nuovo Cliente</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Nome *</Label>
              <Input id="name" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="type">Tipo Cliente *</Label>
              <Select value={form.watch('type')} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CLIENT_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value as ClientType}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="vatNumber">Partita IVA / Tax ID</Label>
              <Input id="vatNumber" {...form.register('vatNumber')} />
            </div>
            <div>
              <Label htmlFor="taxCode">Codice Fiscale</Label>
              <Input id="taxCode" {...form.register('taxCode')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sdiCode">Codice SDI</Label>
              <Input id="sdiCode" {...form.register('sdiCode')} />
            </div>
            <div>
              <Label htmlFor="country">Nazione (ISO)</Label>
              <Input id="country" {...form.register('country')} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="address">Indirizzo</Label>
              <Input id="address" {...form.register('address')} />
            </div>
            <div>
              <Label htmlFor="city">Città</Label>
              <Input id="city" {...form.register('city')} />
            </div>
          </div>

          <div>
            <Label htmlFor="zipCode">CAP</Label>
            <Input id="zipCode" {...form.register('zipCode')} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Annulla
            </Button>
            <Button type="submit">Crea Cliente</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}