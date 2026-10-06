'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loader2, CheckCircle2 } from 'lucide-react';

const settingsSchema = z.object({
  senderName: z.string().min(1, 'Denominazione obbligatoria'),
  senderVat: z.string().length(11, 'Partita IVA deve essere 11 cifre'),
  senderTaxCode: z.string().length(16, 'Codice Fiscale deve essere 16 caratteri'),
  senderAddress: z.string().min(1, 'Indirizzo obbligatorio'),
  senderNumber: z.string().min(1, 'Numero civico obbligatorio'),
  senderZip: z.string().length(5, 'CAP deve essere 5 cifre'),
  senderCity: z.string().min(1, 'Comune obbligatorio'),
  senderProvince: z.string().length(2, 'Provincia (sigla, 2 caratteri)'),
  senderEmail: z.string().email('Email non valida').optional().or(z.literal('')),
  senderPhone: z.string().optional().or(z.literal('')),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

interface SettingsFormProps {
  onSettingsChange?: () => void;
}

export function SettingsForm({ onSettingsChange }: SettingsFormProps) {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      senderName: '',
      senderVat: '',
      senderTaxCode: '',
      senderAddress: '',
      senderNumber: '',
      senderZip: '',
      senderCity: '',
      senderProvince: '',
      senderEmail: '',
      senderPhone: '',
    },
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        form.reset(data);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: SettingsFormData) => {
    setSaved(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || 'Errore salvataggio');
      }

      setSaved(true);
      onSettingsChange?.();
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Errore sconosciuto');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Impostazioni Cedente/Prestatore
        </CardTitle>
        <CardDescription>
          Configura i dati della tua attività per la generazione di fatture XML e PDF.
          Questi dati verranno usati come <strong>Cedente/Prestatore</strong> nelle fatture elettroniche.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Dati Anagrafici</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="senderName">Denominazione / Ragione Sociale *</Label>
                <Input id="senderName" {...form.register('senderName')} />
                {form.formState.errors.senderName && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderName.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="senderVat">Partita IVA *</Label>
                <Input id="senderVat" {...form.register('senderVat')} placeholder="12345678901" maxLength={11} />
                {form.formState.errors.senderVat && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderVat.message}</p>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="senderTaxCode">Codice Fiscale *</Label>
                <Input id="senderTaxCode" {...form.register('senderTaxCode')} placeholder="RSSMRA80A01H501U" maxLength={16} />
                {form.formState.errors.senderTaxCode && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderTaxCode.message}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Sede Legale</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="senderAddress">Indirizzo *</Label>
                <Input id="senderAddress" {...form.register('senderAddress')} />
                {form.formState.errors.senderAddress && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderAddress.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="senderNumber">Numero Civico *</Label>
                <Input id="senderNumber" {...form.register('senderNumber')} />
                {form.formState.errors.senderNumber && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderNumber.message}</p>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="senderZip">CAP *</Label>
                <Input id="senderZip" {...form.register('senderZip')} maxLength={5} />
                {form.formState.errors.senderZip && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderZip.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="senderCity">Comune *</Label>
                <Input id="senderCity" {...form.register('senderCity')} />
                {form.formState.errors.senderCity && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderCity.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="senderProvince">Provincia *</Label>
                <Input id="senderProvince" {...form.register('senderProvince')} maxLength={2} placeholder="RM" />
                {form.formState.errors.senderProvince && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderProvince.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="senderCountry">Nazione</Label>
                <Input id="senderCountry" value="IT" readOnly className="bg-muted" />
              </div>
            </div>
          </div>

          <Separator />

          <div className="border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">Contatti (opzionali)</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="senderEmail">Email</Label>
                <Input id="senderEmail" type="email" {...form.register('senderEmail')} />
                {form.formState.errors.senderEmail && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderEmail.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="senderPhone">Telefono</Label>
                <Input id="senderPhone" {...form.register('senderPhone')} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="submit" disabled={saved}>
              {saved ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Salvato
                </>
              ) : (
                'Salva Impostazioni'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}