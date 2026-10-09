'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function ZkResetForm({ token }: { token: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlToken = token || searchParams.get('token') || '';

  const [zkSecret, setZkSecret] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setFormError('');

    if (!urlToken) {
      setFormError('Token non valido: richiedi una nuova email di reset.');
      setLoading(false);
      return;
    }
    if (!zkSecret.trim()) {
      setFormError('Inserisci la chiave di recupero.');
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
      const res = await fetch('/api/auth/zk-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          token: urlToken,
          zkSecret: zkSecret.trim(),
          newPassword: password,
          confirmPassword: confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setFormError(
          data.error || 'Chiave di recupero non valida o token scaduto. Richiedi una nuova email.'
        );
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
      <div className="w-full max-w-md panel-translucent">
        <div className="p-6">
          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-3">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
            </div>
            <h1 className="text-2xl font-bold">Recupero Password (Zero-Knowledge)</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Il tuo account è in <strong>Modalità Zero-Knowledge</strong>.
              Il recupero richiede la tua <strong>chiave di recupero</strong>.
            </p>
          </div>

          {formError && (
            <div className="alert-box alert-error animate-slide-up mb-4">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          {done ? (
            <div className="alert-box alert-success animate-slide-up text-center">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mx-auto mb-2" />
              <span>Password aggiornata. Ti reindirizziamo al login…</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="zkSecret">Chiave di recupero (base64url)</Label>
                <Input
                  id="zkSecret"
                  type="text"
                  autoComplete="off"
                  value={zkSecret}
                  onChange={(e) => setZkSecret(e.target.value)}
                  placeholder="Incolla qui la tua chiave di recupero (base64url)"
                  required
                  disabled={loading}
                  className="mt-1 font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  La chiave è una stringa base64url di 44 caratteri. 
                  Deve essere stata salvata durante l&apos;attivazione della modalità Zero-Knowledge.
                </p>
              </div>

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
                    Aggiornamento…
                  </>
                ) : (
                  'Imposta nuova password'
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}