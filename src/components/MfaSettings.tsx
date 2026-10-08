'use client';

import { useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, ShieldCheck, Copy, Check } from 'lucide-react';

type Phase =
  | { name: 'loading' }
  | { name: 'disabled' }
  | { name: 'enrolling'; secret: string; otpauthUrl: string; qrPng: string }
  | { name: 'showBackup'; codes: string[] }
  | { name: 'enabled' };

export function MfaSettings() {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch('/api/mfa');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPhase(data.enabled ? { name: 'enabled' } : { name: 'disabled' });
    } catch {
      setError('Impossibile caricare lo stato 2FA');
    }
  };

  useEffect(() => {
    // Caricamento iniziale una tantum: l'effetto non dipende da alcuno stato.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  const call = async (action: string, extra: Record<string, string> = {}) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore 2FA');
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore 2FA');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startEnroll = async () => {
    const data = await call('setup');
    if (!data) return;
    // QR generato interamente in locale: il segreto non lascia mai il browser.
    const qr = qrcode(0, 'M');
    qr.addData(data.otpauthUrl);
    qr.make();
    setPhase({ name: 'enrolling', secret: data.secret, otpauthUrl: data.otpauthUrl, qrPng: qr.createDataURL(6, 4) });
  };

  const confirmEnroll = async () => {
    const data = await call('enable', { code });
    if (data) {
      setCode('');
      setPhase({ name: 'showBackup', codes: data.backupCodes });
    }
  };

  const disable = async () => {
    const data = await call('disable', { code });
    if (data) {
      setCode('');
      await refresh();
    }
  };

  const regenBackup = async () => {
    const data = await call('backup-codes', { code });
    if (data) {
      setCode('');
      setPhase({ name: 'showBackup', codes: data.backupCodes });
    }
  };

  const copySecret = async () => {
    if (phase.name !== 'enrolling') return;
    try {
      await navigator.clipboard.writeText(phase.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copia manuale non riuscita');
    }
  };

  return (
    <Card className="max-w-2xl mx-auto mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          Verifica in due passaggi (2FA)
        </CardTitle>
        <CardDescription>
          Dopo la password ti verrà chiesto un codice a 6 cifre dall&apos;app di autenticazione.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-500">{error}</p>}

        {phase.name === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Caricamento…
          </div>
        )}

        {phase.name === 'disabled' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">2FA non attiva su questo account.</p>
            <Button onClick={startEnroll} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Attiva 2FA
            </Button>
          </div>
        )}

        {phase.name === 'enrolling' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Inquadra il QR code con la tua app di autenticazione (oppure usa segreto/link qui sotto),
              poi inserisci il codice a 6 cifre per confermare.
            </p>
            <div className="flex justify-center bg-white p-3 rounded-lg w-fit">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={phase.qrPng} alt="QR code per l&apos;attivazione 2FA" width={192} height={192} />
            </div>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm bg-muted px-3 py-2 rounded break-all">{phase.secret}</code>
              <Button type="button" variant="outline" size="icon" onClick={copySecret} title="Copia segreto">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <a href={phase.otpauthUrl} className="text-sm text-primary hover:underline font-medium">
              Apri nell&apos;app di autenticazione
            </a>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="mfa-code">Codice a 6 cifre</Label>
                <Input
                  id="mfa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <Button onClick={confirmEnroll} disabled={busy || code.trim().length < 6}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Conferma e attiva
              </Button>
            </div>
          </div>
        )}

        {phase.name === 'showBackup' && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Codici di backup (mostrati una sola volta, conservali al sicuro):</p>
            <ul className="grid gap-1 sm:grid-cols-2 font-mono text-sm bg-muted p-3 rounded">
              {phase.codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button
              onClick={() => {
                setPhase({ name: 'enabled' });
                refresh();
              }}
            >
              Ho salvato i codici, continua
            </Button>
          </div>
        )}

        {phase.name === 'enabled' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">2FA attiva su questo account.</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="mfa-code">Codice a 6 cifre</Label>
                <Input
                  id="mfa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <Button variant="outline" onClick={regenBackup} disabled={busy || code.trim().length < 6}>
                Rigenera backup code
              </Button>
              <Button variant="destructive" onClick={disable} disabled={busy || code.trim().length < 6}>
                Disattiva 2FA
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
