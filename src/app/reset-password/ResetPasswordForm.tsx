'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ResetPasswordFormProps {
  token: string;
  isMfaFlow?: boolean;
}

export default function ResetPasswordForm({ token, isMfaFlow = false }: ResetPasswordFormProps) {
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    if (!token) {
      setFormError('Link non valido: richiedi una nuova email di attivazione.');
      setLoading(false);
      return;
    }
    if (password.length < 12) {
      setFormError('La password deve essere di almeno 12 caratteri');
      setLoading(false);
      return;
    }
    if (password !== confirm) {
      setFormError('Le password non coincidono');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFormError('Link non valido o scaduto: richiedi una nuova email.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch {
      setFormError('Errore durante il salvataggio');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    if (!token) {
      setFormError('Link non valido: richiedi una nuova email di reset.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFormError('Link non valido o scaduto: richiedi una nuova email.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch {
      setFormError('Errore durante il salvataggio');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-app flex items-center justify-center p-4">
      <Card className="w-full max-w-md panel-translucent">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">
          {isMfaFlow ? 'Disattiva verifica in due passaggi' : 'Imposta la tua password'}
        </CardTitle>
        <CardDescription>Il link vale una sola volta e scade in fretta: completalo subito.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formError && (
          <div className="alert-box alert-error animate-slide-up">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{formError}</span>
          </div>
        )}
        {done ? (
          <div className="alert-box alert-success animate-slide-up">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>
              {isMfaFlow
                ? 'Verifica disattivata. Ricordati di riattivarla dalle Impostazioni.'
                : 'Password impostata. Ti reindirizzo al login…'}
            </span>
          </div>
        ) : isMfaFlow ? (
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Confermando disattivi la verifica in due passaggi del tuo account. Dovrai
              riattivarla dalle Impostazioni.
            </p>
            <Button type="submit" className="w-full" disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Disattivazione...
                </>
              ) : (
                'Disattiva verifica in due passaggi'
              )}
            </Button>
          </form>
        ) : (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <Label htmlFor="newPassword">Nuova password (minimo 12 caratteri)</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
                disabled={loading}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword">Ripeti password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={12}
                disabled={loading}
                className="mt-1"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvataggio...
                </>
              ) : (
                'Salva password'
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
    </div>
  );
}