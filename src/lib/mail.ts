import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY non configurata");
  if (!client) client = new Resend(apiKey);
  return client;
}

function getFrom(): string {
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM non configurato");
  return from;
}

// URL canonico per i link nelle email: MAI dall'Host della richiesta
// (Host-header poisoning → furto token). Da env, un solo punto di verità.
export function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    throw new Error("APP_URL non configurato o non valido");
  }
  return url.replace(/\/$/, "");
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Invio best-effort: non lancia mai (il chiamante decide in base a `sent`).
// Non logga mai contenuto o destinatario: solo audit a carico del chiamante.
export async function sendMail(mail: OutgoingMail): Promise<{ sent: boolean; id?: string }> {
  try {
    const { data, error } = await getClient().emails.send({
      from: getFrom(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (error || !data?.id) return { sent: false };
    return { sent: true, id: data.id };
  } catch {
    return { sent: false };
  }
}
