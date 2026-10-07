'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Check, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface ThemeOption {
  id: string;
  label: string;
  previewBackground: string;
  previewAccent: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'mezzanotte',
    label: 'mezzanotte',
    previewBackground: '#0f172a',
    previewAccent: '#3b82f6',
  },
  {
    id: 'aurora',
    label: 'aurora',
    previewBackground: 'linear-gradient(135deg, #ffe4e6 0%, #fef3c7 100%)',
    previewAccent: '#e11d48',
  },
  {
    id: 'tramonto',
    label: 'tramonto',
    previewBackground: '#000000',
    previewAccent: '#ffb000',
  },
];

function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function ThemeSelector() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const mounted = useMounted();

  const options = useMemo(
    () => THEME_OPTIONS.filter((option) => themes.includes(option.id)),
    [themes]
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        title="Cambia tema"
        onClick={() => mounted && setOpen(true)}
        disabled={!mounted}
      >
        <Palette className="w-4 h-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Tema</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {options.map((option) => {
              const isActive = theme === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setTheme(option.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                    isActive ? 'border-primary' : 'border-border'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="h-9 w-9 shrink-0 rounded-md border border-border"
                    style={{ background: option.previewBackground }}
                  >
                    <span
                      className="mx-auto mt-3 block h-2 w-2 rounded-full"
                      style={{ background: option.previewAccent }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{option.label}</span>
                  </span>
                  {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
