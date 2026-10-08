'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';

interface LoginFormProps {
  showRegisterLink: boolean;
}

// Errori restituiti via query param dopo un submit nativo (senza JS).
const QUERY_ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Email o password non validi",
  AccessDenied: "Accesso negato",
  Configuration: "Errore di configurazione del login",
  RateLimited: "Troppe richieste, riprova tra qualche minuto",
};

const JSON_ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Email o password non validi",
  RateLimited: "Troppe richieste, riprova tra qualche minuto",
  Configuration: "Errore di configurazione del login",
};

async function postLoginJson(body: Record<string, string>): Promise<{
  ok?: boolean;
  mfaRequired?: boolean;
  challenge?: string;
  error?: string;
}> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default function LoginForm({ showRegisterLink }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const errorParam = searchParams.get('error');
  const error = errorParam ? (QUERY_ERROR_MESSAGES[errorParam] ?? 'Errore durante il login') : null;

  const initialChallenge = searchParams.get('mfa') === '1' ? searchParams.get('challenge') || '' : '';
  const [step, setStep] = useState<'credentials' | 'mfa'>(initialChallenge ? 'mfa' : 'credentials');
  const [challenge, setChallenge] = useState(initialChallenge);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const handleCredentialsSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    // Legge dal FormData reale: alcuni autofill su mobile riempiono il DOM
    // senza aggiornare lo stato React, e senza questo il submit resterebbe vuoto.
    const formData = new FormData(e.currentTarget);
    const submitEmail = String(formData.get('email') || '').trim() || email.trim();
    const submitPassword = String(formData.get('password') || '') || password;

    if (!submitEmail || !submitPassword) {
      setFormError('Inserisci email e password');
      setLoading(false);
      return;
    }

    try {
      const result = await postLoginJson({ email: submitEmail, password: submitPassword, callbackUrl });
      if (result.mfaRequired && result.challenge) {
        setChallenge(result.challenge);
        setTotpCode('');
        setStep('mfa');
      } else if (result.ok) {
        router.push(callbackUrl);
        router.refresh();
      } else {
        setFormError(JSON_ERROR_MESSAGES[result.error || ''] ?? 'Errore durante il login');
      }
    } catch (err) {
      setFormError('Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    const formData = new FormData(e.currentTarget);
    const submitChallenge = String(formData.get('challenge') || '') || challenge;
    const submitCode = String(formData.get('totpCode') || '').trim() || totpCode.trim();

    if (!submitChallenge || !submitCode) {
      setFormError('Inserisci il codice di verifica');
      setLoading(false);
      return;
    }

    try {
      const result = await postLoginJson({ challenge: submitChallenge, totpCode: submitCode, callbackUrl });
      if (result.ok) {
        router.push(callbackUrl);
        router.refresh();
      } else {
        setFormError('Codice non valido, riprova');
      }
    } catch (err) {
      setFormError('Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md panel-translucent">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">Solo</CardTitle>
        <CardDescription>Gestionale Fatture Regime Forfettario</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(error || formError) && (
          <div className="alert-box alert-error animate-slide-up">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{formError || error || 'Credenziali non valide'}</span>
          </div>
        )}

        {step === 'credentials' ? (
          <form method="post" action="/api/login" onSubmit={handleCredentialsSubmit} className="space-y-4">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                disabled={loading}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                className="mt-1"
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Accesso...
                </>
              ) : (
                'Accedi'
              )}
            </Button>
          </form>
        ) : (
          <form method="post" action="/api/login" onSubmit={handleMfaSubmit} className="space-y-4">
            <input type="hidden" name="challenge" value={challenge} />
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <div>
              <Label htmlFor="totpCode">Codice di verifica</Label>
              <Input
                id="totpCode"
                name="totpCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="123456"
                required
                disabled={loading}
                className="mt-1"
              />
              <p className="text-sm text-muted-foreground mt-2">
                Inserisci il codice a 6 cifre dell&apos;app di autenticazione (oppure un codice di backup).
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifica...
                </>
              ) : (
                'Verifica'
              )}
            </Button>
          </form>
        )}

        {showRegisterLink && (
          <p className="text-center text-sm text-muted-foreground">
            Prima volta?{' '}
            <a href="/register" className="text-primary hover:underline font-medium">
              Crea il primo utente amministratore
            </a>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
