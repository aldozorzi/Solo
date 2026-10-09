'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, ShieldCheck, Copy, Check, AlertTriangle, Download } from 'lucide-react';

type Phase =
  | { name: 'loading' }
  | { name: 'disabled' }
  | { name: 'enrolling'; recoveryKey: string; qrPng: string; pendingToken: string }
  | { name: 'enabled' }
  | { name: 'confirmDisable' }
  | { name: 'rotatePrep' }
  | { name: 'rotateShow'; newRecoveryKey: string; qrPng: string; pendingToken: string };

async function qrFor(text: string): Promise<string> {
  const qrcode = (await import('qrcode-generator')).default;
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 4);
}

export function ZeroKnowledgeSettings() {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // Checkbox di conferma: l'attivazione/rotazione si committa solo dopo il loro spunta.
  const [ack, setAck] = useState(false);
  const [saved, setSaved] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch('/api/auth/zero-knowledge/status');
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.enabled) {
        setPhase({ name: 'enabled' });
      } else {
        setPhase({ name: 'disabled' });
      }
    } catch {
      setError('Impossibile caricare lo stato Zero-Knowledge');
    }
  };

  useEffect(() => {
    // Caricamento iniziale una tantum.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  const call = async (action: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/zero-knowledge/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Errore');
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
      return null;
    } finally {
      setBusy(false);
    }
  };

  // Fase 1 attivazione: genera e mostra la chiave. NON attiva nulla.
  const prepareEnable = async () => {
    const data = await call('enable', { action: 'prepare' });
    if (!data) return;
    const qrPng = await qrFor(data.recoveryKey);
    setSaved(false);
    setPhase({ name: 'enrolling', recoveryKey: data.recoveryKey, qrPng, pendingToken: data.pendingToken });
  };

  // Fase 2 attivazione: commit solo al click esplicito dell'utente.
  const confirmEnable = async () => {
    if (phase.name !== 'enrolling') return;
    const data = await call('enable', {
      action: 'confirm',
      pendingToken: phase.pendingToken,
      confirmDisclaimer: true,
    });
    if (data) {
      setSaved(false);
      await refresh();
    }
  };

  // Fase 1 rotazione: step-up password, genera e mostra la nuova chiave.
  const prepareRotate = async () => {
    const data = await call('rotate-secret', { action: 'prepare', password });
    if (!data) return;
    const qrPng = await qrFor(data.newRecoveryKey);
    setPassword('');
    setSaved(false);
    setPhase({ name: 'rotateShow', newRecoveryKey: data.newRecoveryKey, qrPng, pendingToken: data.pendingToken });
  };

  // Fase 2 rotazione: commit solo al click esplicito dell'utente.
  const confirmRotate = async () => {
    if (phase.name !== 'rotateShow') return;
    const data = await call('rotate-secret', { action: 'confirm', pendingToken: phase.pendingToken });
    if (data) {
      setSaved(false);
      await refresh();
    }
  };

  const disable = async () => {
    const data = await call('disable', { password });
    if (data) {
      setPassword('');
      await refresh();
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copia manuale non riuscita');
    }
  };

  const download = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const keyBox = (key: string, qrPng: string, filename: string) => (
    <div className="space-y-3">
      <div className="flex justify-center bg-white p-3 rounded-lg w-fit mx-auto">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrPng} alt="QR code chiave di recupero" width={192} height={192} />
      </div>
      <div className="flex items-center gap-2">
        <code className="font-mono text-sm bg-muted px-3 py-2 rounded break-all flex-1">{key}</code>
        <Button type="button" variant="outline" size="icon" onClick={() => copy(key)} title="Copia chiave">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </Button>
      </div>
      <Button variant="outline" onClick={() => download(key, filename)} className="w-full">
        <Download className="w-4 h-4 mr-2" /> Scarica chiave
      </Button>
    </div>
  );

  const savedCheckbox = (id: string) => (
    <label className="flex items-center gap-2">
      <input id={id} type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <span className="text-sm font-medium">Ho salvato la chiave in luogo sicuro</span>
    </label>
  );

  return (
    <Card className="max-w-2xl mx-auto mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          Modalità Zero-Knowledge
        </CardTitle>
        <CardDescription>
          Quando attiva, il recupero password avviene solo con la tua chiave di recupero.
          Nessun fallback server, nessuna email di reset. Se perdi la chiave, i dati sono persi per sempre.
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
          <div className="space-y-4">
            <div className="p-4 border border-orange-200 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-medium text-orange-800">Attenzione: Modalità Zero-Knowledge</h3>
                  <p className="text-sm text-orange-700 mt-1">
                    Attivando questa modalità, <strong>nessuno</strong> (né noi, né amministratori)
                    potrà recuperare i tuoi dati se perdi la chiave.
                  </p>
                  <ul className="text-sm text-orange-700 mt-2 list-disc list-inside space-y-1">
                    <li>Non potrai reimpostare la password via email</li>
                    <li>L&apos;unico accesso ai dati è: password + chiave di recupero</li>
                    <li>Se perdi la chiave, i dati sono persi per sempre</li>
                  </ul>
                </div>
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span className="text-sm font-medium">
                Ho letto e compreso i rischi e me ne assumo la responsabilità.
              </span>
            </label>
            <Button onClick={prepareEnable} disabled={busy || !ack} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Genera chiave di recupero
            </Button>
          </div>
        )}

        {phase.name === 'enrolling' && (
          <div className="space-y-4 border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-orange-800 font-medium">
              Salva la chiave: la modalità <strong>non è ancora attiva</strong>.
            </p>
            {keyBox(phase.recoveryKey, phase.qrPng, 'solo-zk-recovery-key.txt')}
            {savedCheckbox('zk-saved')}
            <Button
              onClick={confirmEnable}
              disabled={busy || !saved}
              className="w-full"
            >
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              ATTIVA Zero-Knowledge
            </Button>
          </div>
        )}

        {phase.name === 'enabled' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 w-fit">
              <ShieldCheck className="w-5 h-5 text-green-600" />
              <span className="font-medium text-green-800">Zero-Knowledge ATTIVA</span>
            </div>
            <p className="text-sm text-muted-foreground">
              La chiave di recupero è stata mostrata una sola volta. Se l&apos;hai persa, genera una
              nuova chiave (ti verrà chiesta la password).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => { setPassword(''); setError(''); setPhase({ name: 'rotatePrep' }); }}
                disabled={busy}
              >
                Genera nuova chiave di recupero
              </Button>
              <Button
                variant="destructive"
                onClick={() => { setPassword(''); setError(''); setPhase({ name: 'confirmDisable' }); }}
                disabled={busy}
              >
                Disattiva Zero-Knowledge
              </Button>
            </div>
          </div>
        )}

        {phase.name === 'rotatePrep' && (
          <div className="space-y-4 border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-orange-800 font-medium">Genera una nuova chiave di recupero</p>
            <p className="text-sm text-orange-700">
              Inserisci la password per autorizzare. Verrà generata una nuova chiave: la precedente
              smetterà di funzionare <strong>solo dopo la tua conferma</strong>.
            </p>
            <div>
              <Label htmlFor="rotate-password">Password attuale</Label>
              <Input
                id="rotate-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password per conferma"
                className="mt-1"
                disabled={busy}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPhase({ name: 'enabled' })} disabled={busy}>
                Annulla
              </Button>
              <Button onClick={prepareRotate} disabled={busy || password.length < 12}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Genera nuova chiave
              </Button>
            </div>
          </div>
        )}

        {phase.name === 'rotateShow' && (
          <div className="space-y-4 border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-orange-800 font-medium">
              Nuova chiave generata: la vecchia è <strong>ancora valida</strong> finché non confermi.
            </p>
            {keyBox(phase.newRecoveryKey, phase.qrPng, 'solo-zk-recovery-key.txt')}
            {savedCheckbox('zk-new-saved')}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPhase({ name: 'enabled' })} disabled={busy}>
                Annulla
              </Button>
              <Button onClick={confirmRotate} disabled={busy || !saved} className="flex-1">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Conferma nuova chiave
              </Button>
            </div>
          </div>
        )}

        {phase.name === 'confirmDisable' && (
          <div className="space-y-4 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-700">
              Disattivando la modalità Zero-Knowledge tornerai alla modalità standard, con recupero
              via email. La chiave di recupero non sarà più necessaria.
            </p>
            <div>
              <Label htmlFor="disable-password">Password attuale</Label>
              <Input
                id="disable-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password per conferma"
                className="mt-1"
                disabled={busy}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPhase({ name: 'enabled' })} disabled={busy}>
                Annulla
              </Button>
              <Button
                variant="destructive"
                onClick={disable}
                disabled={busy || password.length < 12}
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Disattiva definitivamente
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
