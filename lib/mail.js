// E-Mail-Versand über Resend (RESEND_API_KEY) oder einen eigenen SMTP-Server (SMTP_HOST …)
const outbox = [];   // nur für MAIL_TRANSPORT=log (lokale Tests)

export function mailInfo() {
  const from = process.env.MAIL_FROM || '';
  if (process.env.MAIL_TRANSPORT === 'log') return { configured: true, provider: 'Testprotokoll', from: from || 'terminplaner@localhost' };
  if (process.env.RESEND_API_KEY && from) return { configured: true, provider: 'Resend', from };
  if (process.env.SMTP_HOST && from) return { configured: true, provider: 'SMTP ' + process.env.SMTP_HOST, from };
  return { configured: false, provider: null, from };
}
export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return '';
}
export const sentMails = () => outbox;
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// text: Klartext; die HTML-Fassung entsteht daraus (Absätze, Links)
export async function sendMail({ to, subject, text }) {
  const info = mailInfo();
  if (!info.configured) throw new Error('E-Mail-Versand ist nicht eingerichtet');
  to = String(to || '').trim();
  if (to.length > 200 || /[\r\n,;]/.test(to) || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(to)) throw new Error('Ungültige E-Mail-Adresse');
  // Schutz vor Header-Injection: Betreff einzeilig und begrenzt
  subject = String(subject || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);
  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#16231d">' +
    escHtml(text).split('\n\n').map(p => '<p>' + p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>') + '</p>').join('') + '</div>';
  if (process.env.MAIL_TRANSPORT === 'log') { outbox.push({ to, subject, text }); console.log('[Mail an ' + to + '] ' + subject); return; }
  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: info.from, to: [to], subject, text, html })
    });
    if (!r.ok) throw new Error('Resend meldet ' + r.status);
    return;
  }
  const nodemailer = (await import('nodemailer')).default;
  const port = Number(process.env.SMTP_PORT || 587);
  // TLS ist Pflicht (465: direkt, sonst STARTTLS), Zertifikat wird geprüft, mindestens TLS 1.2
  const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: process.env.SMTP_HOST },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined });
  await t.sendMail({ from: info.from, to, subject, text, html });
}
