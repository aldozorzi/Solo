const CF_CHECK_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CF_ODD_VALUES: Record<string, number> = {
  '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  'A': 1, 'B': 0, 'C': 5, 'D': 7, 'E': 9, 'F': 13, 'G': 15, 'H': 17, 'I': 19, 'J': 21,
  'K': 2, 'L': 4, 'M': 18, 'N': 20, 'O': 11, 'P': 3, 'Q': 6, 'R': 8, 'S': 12, 'T': 14,
  'U': 16, 'V': 10, 'W': 22, 'X': 25, 'Y': 24, 'Z': 23,
};

function cfEvenValue(char: string): number {
  return char >= '0' && char <= '9' ? Number(char) : char.charCodeAt(0) - 65;
}

/**
 * Verifica il carattere di controllo del Codice Fiscale (All. A, errore FeX 161).
 */
export function isValidCodiceFiscale(value: string): boolean {
  const cf = (value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{16}$/.test(cf)) return false;

  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const char = cf[i];
    if (i % 2 === 0) {
      const oddValue = CF_ODD_VALUES[char];
      if (oddValue === undefined) return false;
      sum += oddValue;
    } else {
      sum += cfEvenValue(char);
    }
  }

  return CF_CHECK_CHARS[sum % 26] === cf[15];
}

/**
 * Verifica il carattere di controllo della Partita IVA italiana (errore FeX 159).
 */
export function isValidPartitaIVA(value: string): boolean {
  const piva = (value || '').trim();
  if (!/^\d{11}$/.test(piva)) return false;

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = Number(piva[i]);
    if (i % 2 === 0) {
      sum += digit;
    } else {
      const doubled = digit * 2;
      sum += doubled >= 10 ? doubled - 9 : doubled;
    }
  }

  return (10 - (sum % 10)) % 10 === Number(piva[10]);
}
