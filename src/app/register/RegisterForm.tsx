'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';

export default function RegisterForm() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    email: '',
    name: '',
    password: '',
    confirmPassword: '',
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
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (formData.password !== formData.confirmPassword) {
      setError('Le password non coincidono');
      return;
    }

    if (formData.password.length < 8) {
      setError('La password deve essere di almeno 8 caratteri');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          name: formData.name,
          password: formData.password,
          businessName: formData.businessName,
          vatNumber: formData.vatNumber,
          taxCode: formData.taxCode,
          address: formData.address,
          city: formData.city,
          zipCode: formData.zipCode,
          province: formData.province,
          country: formData.country,
          taxRegime: formData.taxRegime,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Errore durante la registrazione');
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
        router.refresh();
      }, 2000);
    } catch (err) {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-app flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl panel-translucent">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <ShieldCheck className="w-8 h-8 text-primary" />
            <CardTitle className="text-2xl font-bold">Primo Accesso</CardTitle>
          </div>
          <CardDescription>
            Crea l'utente amministratore iniziale. Questa pagina non sarà più accessibile dopo la creazione del primo utente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="alert-box alert-error animate-slide-up">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="alert-box alert-success animate-slide-up">
              <ShieldCheck className="w-4 h-4 flex-shrink-0" />
              <span>Utente creato con successo! Reindirizzamento al login...</span>
            </div>
          )}

          {!success && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="admin@example.com"
                    required
                    disabled={loading}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="name">Nome *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    placeholder="Mario Rossi"
                    required
                    disabled={loading}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="password">Password *</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    required
                    disabled={loading}
                    className="mt-1"
                    minLength={8}
                  />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">Conferma Password *</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => handleChange('confirmPassword', e.target.value)}
                    required
                    disabled={loading}
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold mb-4">Dati Fiscali Emittente</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="businessName">Denominazione / Ragione Sociale *</Label>
                    <Input
                      id="businessName"
                      value={formData.businessName}
                      onChange={(e) => handleChange('businessName', e.target.value)}
                      placeholder="Mario Rossi / Rossi S.r.l."
                      required
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="vatNumber">Partita IVA *</Label>
                    <Input
                      id="vatNumber"
                      value={formData.vatNumber}
                      onChange={(e) => handleChange('vatNumber', e.target.value)}
                      placeholder="12345678901"
                      required
                      disabled={loading}
                      className="mt-1"
                      maxLength={11}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="taxCode">Codice Fiscale *</Label>
                    <Input
                      id="taxCode"
                      value={formData.taxCode}
                      onChange={(e) => handleChange('taxCode', e.target.value)}
                      placeholder="RSSMRA80A01H501U"
                      required
                      disabled={loading}
                      className="mt-1"
                      maxLength={16}
                    />
                  </div>
                  <div>
                    <Label htmlFor="taxRegime">Regime Fiscale *</Label>
                    <Select value={formData.taxRegime} onValueChange={(v) => handleChange('taxRegime', v)} required disabled={loading}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FORFETTARIO">Forfettario</SelectItem>
                        <SelectItem value="ORDINARIO">Ordinario</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="senderType">Tipologia Soggetto *</Label>
                    <Select value={formData.senderType} onValueChange={(v) => handleChange('senderType', v)} required disabled={loading}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LIBERO_PROFESSIONISTA">Libero Professionista</SelectItem>
                        <SelectItem value="DITTA_INDIVIDUALE">Ditta Individuale</SelectItem>
                        <SelectItem value="SOCIETA">Società</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="address">Indirizzo *</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => handleChange('address', e.target.value)}
                      placeholder="Via Roma 1"
                      required
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="city">Comune *</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => handleChange('city', e.target.value)}
                      placeholder="Roma"
                      required
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-4">
                  <div>
                    <Label htmlFor="zipCode">CAP *</Label>
                    <Input
                      id="zipCode"
                      value={formData.zipCode}
                      onChange={(e) => handleChange('zipCode', e.target.value)}
                      placeholder="00100"
                      required
                      disabled={loading}
                      className="mt-1"
                      maxLength={5}
                    />
                  </div>
                  <div>
                    <Label htmlFor="province">Provincia *</Label>
                    <Input
                      id="province"
                      value={formData.province}
                      onChange={(e) => handleChange('province', e.target.value)}
                      placeholder="RM"
                      required
                      disabled={loading}
                      className="mt-1"
                      maxLength={2}
                    />
                  </div>
                  <div>
                    <Label htmlFor="country">Nazione</Label>
                    <Input
                      id="country"
                      value={formData.country}
                      onChange={(e) => handleChange('country', e.target.value)}
                      disabled={loading}
                      className="mt-1 bg-muted"
                      readOnly
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading} size="lg">
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Crea Utente Amministratore
                  </>
                ) : (
                  'Crea Utente Amministratore'
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}