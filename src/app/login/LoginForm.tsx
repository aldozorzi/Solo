'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle } from 'lucide-react';

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    try {
      const result = await signIn('credentials', {
        email,
        password,
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
          <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm animate-slide-up">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{formError || error || 'Credenziali non valide'}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
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
              type="password"
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

        <p className="text-center text-sm text-muted-foreground">
          Prima volta?{' '}
          <a href="/register" className="text-primary hover:underline font-medium">
            Crea il primo utente amministratore
          </a>
        </p>
      </CardContent>
    </Card>
  );
}