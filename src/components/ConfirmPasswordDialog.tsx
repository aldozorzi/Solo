'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

interface ConfirmPasswordDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

// Step-up authentication: per le azioni sensibili si richiede la password
// corrente di chi esegue l'operazione, mai memorizzata oltre l'uso immediato.
export function ConfirmPasswordDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmPasswordDialogProps) {
  const [password, setPassword] = useState('');

  const close = () => {
    setPassword('');
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = password;
            setPassword('');
            onConfirm(value);
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="confirm-password">La tua password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              Annulla
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !password}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
