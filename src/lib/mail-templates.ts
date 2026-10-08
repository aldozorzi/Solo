import { appUrl } from "./mail";

export interface MailTemplate {
  subject: string;
  html: string;
  text: string;
}

function layout(title: string, bodyHtml: string, bodyText: string): MailTemplate {
  return {
    subject: title,
    html: `<!doctype html><html lang="it"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;"><h2>${title}</h2>${bodyHtml}<p style="color:#555;font-size:13px;">Solo — gestionale fatture</p></body></html>`,
    text: `${title}\n\n${bodyText}\n\nSolo — gestionale fatture`,
  };
}

function resetLink(token: string, flow?: "mfa"): string {
  const base = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return flow ? `${base}&flow=${flow}` : base;
}

export function setupAccountMail(name: string, token: string): MailTemplate {
  const link = resetLink(token);
  return layout(
    "Attiva il tuo account Solo",
    `<p>Ciao ${escapeHtml(name)},</p><p>è stato creato un account per te. Imposta la password entro <strong>24 ore</strong>:</p><p><a href="${link}">Attiva account</a></p><p>Se non hai richiesto tu questo account, ignora pure questa email.</p>`,
    `Ciao ${name},\n\nè stato creato un account per te. Imposta la password entro 24 ore:\n${link}\n\nSe non hai richiesto tu questo account, ignora pure questa email.`
  );
}

export function passwordResetMail(name: string, token: string): MailTemplate {
  const link = resetLink(token);
  return layout(
    "Reimposta la tua password Solo",
    `<p>Ciao ${escapeHtml(name)},</p><p>puoi reimpostare la password entro <strong>15 minuti</strong>:</p><p><a href="${link}">Reimposta password</a></p><p>Se non hai richiesto tu il reset, ignora pure questa email: la password resta invariata.</p>`,
    `Ciao ${name},\n\npuoi reimpostare la password entro 15 minuti:\n${link}\n\nSe non hai richiesto tu il reset, ignora pure questa email: la password resta invariata.`
  );
}

export function mfaResetMail(name: string, token: string): MailTemplate {
  const link = resetLink(token, "mfa");
  return layout(
    "Reimposta la verifica in due passaggi",
    `<p>Ciao ${escapeHtml(name)},</p><p>puoi disattivare la verifica in due passaggi entro <strong>15 minuti</strong> (dovrai poi riattivarla dalle Impostazioni):</p><p><a href="${link}">Reimposta verifica in due passaggi</a></p><p>Se non hai richiesto tu il reset, ignora pure questa email.</p>`,
    `Ciao ${name},\n\npuoi disattivare la verifica in due passaggi entro 15 minuti (dovrai poi riattivarla dalle Impostazioni):\n${link}\n\nSe non hai richiesto tu il reset, ignora pure questa email.`
  );
}

export function securityNoticeMail(name: string, what: string): MailTemplate {
  return layout(
    "Avviso di sicurezza Solo",
    `<p>Ciao ${escapeHtml(name)},</p><p>${escapeHtml(what)}</p><p>Se non sei stato tu, contatta subito l'amministratore di sistema.</p>`,
    `Ciao ${name},\n\n${what}\n\nSe non sei stato tu, contatta subito l'amministratore di sistema.`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
