'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';

interface LoginFormProps {
  showRegisterLink: boolean;
}

// Errori via query param dai redirect di NextAuth (sicurezza: solo codici noti).
const QUERY_ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Email o password non validi",
  AccessDenied: "Accesso negato",
  Configuration: "Errore di configurazione del login",
  RateLimited: "Troppe richieste, riprova tra qualche minuto",
  SessionExpired: "Sessione scaduta, effettua di nuovo il login",
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
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const errorParam = searchParams.get('error');
  const error = errorParam ? (QUERY_ERROR_MESSAGES[errorParam] ?? 'Errore durante il login') : null;

  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [challenge, setChallenge] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');

  const handleCredentialsSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    const submitEmail = email.trim();
    if (!submitEmail || !password) {
      setFormError('Inserisci email e password');
      setLoading(false);
      return;
    }

    try {
      const result = await postLoginJson({ email: submitEmail, password, callbackUrl });
      if (result.mfaRequired && result.challenge) {
        setChallenge(result.challenge);
        setTotpCode('');
        setStep('mfa');
      } else if (result.ok) {
        // Hard navigation: forza reinizializzazione SessionProvider col cookie appena impostato.
        // Equivalente a F5 ma automatico. Elimina ogni race tra update() e navigazione.
        window.location.href = callbackUrl;
      } else {
        setFormError(JSON_ERROR_MESSAGES[result.error || ''] ?? 'Errore durante il login');
      }
    } catch {
      setFormError('Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    const submitCode = totpCode.trim();
    if (!challenge || !submitCode) {
      setFormError('Inserisci il codice di verifica');
      setLoading(false);
      return;
    }

    try {
      const result = await postLoginJson({ challenge, totpCode: submitCode, callbackUrl });
      if (result.ok) {
        window.location.href = callbackUrl;
      } else {
        setFormError('Codice non valido, riprova');
      }
    } catch {
      setFormError('Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setForgotLoading(true);

    const submitEmail = forgotEmail.trim();

    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: submitEmail, kind: 'password' }),
      });
    } catch {
      // Silenzioso di proposito: la risposta è sempre uniforme.
    } finally {
      setForgotLoading(false);
      // Messaggio identico in ogni caso: non rivela se l'email esiste.
      setForgotDone(true);
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

        {step === 'mfa' ? (
          <form onSubmit={handleMfaSubmit} className="space-y-4">
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
        ) : showForgot ? (
          <>
            {forgotDone ? (
              <p className="text-sm text-muted-foreground text-center">
                Se l&apos;indirizzo è registrato, riceverai un&apos;email con le istruzioni per reimpostare la password.
              </p>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-3">
                <div>
                  <Label htmlFor="forgotEmail">Email per il recupero</Label>
                  <Input
                    id="forgotEmail"
                    name="email"
                    type="email"
                    autoComplete="username"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="nome@esempio.it"
                    required
                    disabled={forgotLoading}
                    className="mt-1"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={forgotLoading}>
                  {forgotLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Invio...
                    </>
                  ) : (
                    'Invia link di reset'
                  )}
                </Button>
              </form>
            )}
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-primary hover:underline font-medium"
                onClick={() => {
                  setShowForgot(false);
                  setForgotDone(false);
                }}
              >
                Torna al login
              </button>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
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

            <div className="text-center">
              <button
                type="button"
                className="text-sm text-primary hover:underline font-medium"
                onClick={() => {
                  setForgotEmail(email);
                  setShowForgot(true);
                  setForgotDone(false);
                }}
              >
                Password dimenticata?
              </button>
            </div>
          </>
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
