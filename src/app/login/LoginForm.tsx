'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';

interface LoginFormProps {
  showRegisterLink: boolean;
}

// Errori restituiti da NextAuth via query param dopo un submit nativo (senza JS).
const QUERY_ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Email o password non validi",
  AccessDenied: "Accesso negato",
  Configuration: "Errore di configurazione del login",
};

export default function LoginForm({ showRegisterLink }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const errorParam = searchParams.get('error');
  const error = errorParam ? (QUERY_ERROR_MESSAGES[errorParam] ?? 'Errore durante il login') : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    // Legge dal FormData reale: alcuni autofill su mobile riempiono il DOM
    // senza aggiornare lo stato React, e senza questo il submit resterebbe vuoto.
    const formData = new FormData(e.currentTarget);
    const formEmail = String(formData.get('email') || '').trim();
    const formPassword = String(formData.get('password') || '');
    const submitEmail = formEmail || email.trim();
    const submitPassword = formPassword || password;

    if (!submitEmail || !submitPassword) {
      setFormError('Inserisci email e password');
      setLoading(false);
      return;
    }

    try {
      const result = await signIn('credentials', {
        email: submitEmail,
        password: submitPassword,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setFormError('Email o password non validi');
      } else if (result?.ok) {
        router.push(callbackUrl);
        router.refresh();
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

        {/* action nativo come fallback: se il JS non gira (es. certi browser mobile),
            il browser fa POST diretto a /api/login che verifica le credenziali,
            imposta il cookie di sessione e reindirizza a callbackUrl.
            Con JS attivo, handleSubmit fa preventDefault e usa signIn. */}
        <form method="post" action="/api/login" onSubmit={handleSubmit} className="space-y-4">
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