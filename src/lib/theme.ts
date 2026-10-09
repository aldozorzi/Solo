// Costanti e script tema condivisi tra provider (client) e layout (server).
// Nessuna direttiva "use client" qui: il valore `themeScript` deve essere
// importabile da un Server Component.

export const THEMES = ['mezzanotte', 'aurora', 'tramonto', 'dark', 'light'] as const;
export type ThemeName = (typeof THEMES)[number];

export const SOLO_STORAGE_KEY = 'solo-theme';
export const DARK_THEMES: string[] = ['dark', 'mezzanotte', 'tramonto'];

// Applica il tema prima del primo paint (no-flash). Renderizzato nell'HTML
// iniziale dal layout server, quindi non genera il warning React 19 sui <script>
// creati durante il render dei componenti client.
export const themeScript = `(function(){try{var t=${JSON.stringify(
  THEMES
)};var d=document.documentElement;var e=localStorage.getItem(${JSON.stringify(
  SOLO_STORAGE_KEY
)})||"system";var s=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=e==="system"?s:e;d.classList.remove.apply(d.classList,t);d.classList.add(r);d.style.colorScheme=${JSON.stringify(
  DARK_THEMES
)}.indexOf(r)!==-1?"dark":"light";}catch(e){}})();`;
