'use client';

import { useRef } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { themeScript } from '@/lib/theme';

// Inserisce lo script del tema solo nell'HTML generato dal server, fuori
// dall'albero React idratato. Così il tema è applicato prima del primo paint e
// React 19 non prova a montare un <script> durante l'idratazione.
export function ThemeScript() {
  const inserted = useRef(false);

  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;

    return (
      <script
        id="theme-no-flash"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: themeScript }}
      />
    );
  });

  return null;
}
