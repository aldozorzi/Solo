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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isValidCodiceFiscale, isValidPartitaIVA } from '@/lib/fiscal-code';
import { MfaSettings } from './MfaSettings';
import { ZeroKnowledgeSettings } from './ZeroKnowledgeSettings';

const settingsSchema = z.object({
  businessName: z.string().min(1, 'Denominazione obbligatoria'),
  vatNumber: z
    .string()
    .trim()
    .toUpperCase()
    .length(11, 'Partita IVA deve essere 11 cifre')
    .refine(isValidPartitaIVA, { message: 'Partita IVA non valida (codice di controllo errato)' }),
  taxCode: z
    .string()
    .trim()
    .toUpperCase()
    .length(16, 'Codice Fiscale deve essere 16 caratteri')
    .refine(isValidCodiceFiscale, { message: 'Codice Fiscale non valido (codice di controllo errato)' }),
  address: z.string().min(1, 'Indirizzo obbligatorio'),
  city: z.string().min(1, 'Comune obbligatorio'),
  zipCode: z.string().length(5, 'CAP deve essere 5 cifre'),
  province: z.string().length(2, 'Provincia (sigla, 2 caratteri)'),
  country: z.string().min(1).default('IT'),
  taxRegime: z.enum(['FORFETTARIO', 'ORDINARIO']),
  senderType: z.enum(['LIBERO_PROFESSIONISTA', 'DITTA_INDIVIDUALE', 'SOCIETA']),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

interface SettingsFormProps {
  onSettingsChange?: () => void;
}

export function SettingsForm({ onSettingsChange }: SettingsFormProps) {
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema) as any,
    defaultValues: {
      businessName: '',
      vatNumber: '',
      taxCode: '',
      address: '',
      city: '',
      zipCode: '',
      province: '',
      country: 'IT',
      taxRegime: 'FORFETTARIO',
      senderType: 'LIBERO_PROFESSIONISTA',
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
        form.reset({
          businessName: data.senderName || '',
          vatNumber: data.senderVat || '',
          taxCode: data.senderTaxCode || '',
          address: data.senderAddress || '',
          city: data.senderCity || '',
          zipCode: data.senderZip || '',
          province: data.senderProvince || '',
          country: data.senderCountry || 'IT',
          taxRegime: data.senderTaxRegime || 'FORFETTARIO',
          senderType: data.senderType || 'LIBERO_PROFESSIONISTA',
        });
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
    <>
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
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          <div className="space-y-6 border-t pt-8">
            <h3 className="text-lg font-semibold mb-5">Dati Anagrafici</h3>
            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="businessName">Denominazione / Ragione Sociale *</Label>
                <Input id="businessName" {...form.register('businessName')} />
                {form.formState.errors.businessName && (
                  <p className="text-sm text-red-500">{form.formState.errors.businessName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="vatNumber">Partita IVA *</Label>
                <Input id="vatNumber" {...form.register('vatNumber')} placeholder="12345678901" maxLength={11} />
                {form.formState.errors.vatNumber && (
                  <p className="text-sm text-red-500">{form.formState.errors.vatNumber.message}</p>
                )}
              </div>
            </div>
            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="taxCode">Codice Fiscale *</Label>
                <Input id="taxCode" {...form.register('taxCode')} placeholder="RSSMRA80A01H501U" maxLength={16} />
                {form.formState.errors.taxCode && (
                  <p className="text-sm text-red-500">{form.formState.errors.taxCode.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="senderType">Tipologia Soggetto *</Label>
                <Select value={form.watch('senderType')} onValueChange={(v) => form.setValue('senderType', v as 'LIBERO_PROFESSIONISTA' | 'DITTA_INDIVIDUALE' | 'SOCIETA')} required>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LIBERO_PROFESSIONISTA">Libero Professionista</SelectItem>
                    <SelectItem value="DITTA_INDIVIDUALE">Ditta Individuale</SelectItem>
                    <SelectItem value="SOCIETA">Società</SelectItem>
                  </SelectContent>
                </Select>
                {form.formState.errors.senderType && (
                  <p className="text-sm text-red-500">{form.formState.errors.senderType.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxRegime">Regime Fiscale *</Label>
                <Select value={form.watch('taxRegime')} onValueChange={(v) => form.setValue('taxRegime', v as 'FORFETTARIO' | 'ORDINARIO')} required>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FORFETTARIO">Forfettario</SelectItem>
                    <SelectItem value="ORDINARIO">Ordinario</SelectItem>
                  </SelectContent>
                </Select>
                {form.formState.errors.taxRegime && (
                  <p className="text-sm text-red-500">{form.formState.errors.taxRegime.message}</p>
                )}
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-6 border-t pt-8">
            <h3 className="text-lg font-semibold mb-5">Sede Legale</h3>
            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="address">Indirizzo *</Label>
                <Input id="address" {...form.register('address')} />
                {form.formState.errors.address && (
                  <p className="text-sm text-red-500">{form.formState.errors.address.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Comune *</Label>
                <Input id="city" {...form.register('city')} />
                {form.formState.errors.city && (
                  <p className="text-sm text-red-500">{form.formState.errors.city.message}</p>
                )}
              </div>
            </div>
            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="zipCode">CAP *</Label>
                <Input id="zipCode" {...form.register('zipCode')} maxLength={5} />
                {form.formState.errors.zipCode && (
                  <p className="text-sm text-red-500">{form.formState.errors.zipCode.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="province">Provincia *</Label>
                <Input id="province" {...form.register('province')} maxLength={2} placeholder="RM" />
                {form.formState.errors.province && (
                  <p className="text-sm text-red-500">{form.formState.errors.province.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Nazione</Label>
                <Select value={form.watch('country')} onValueChange={(v) => form.setValue('country', v)} required disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IT">Italia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t">
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
    <MfaSettings />
      <ZeroKnowledgeSettings />
    </>
  );
}