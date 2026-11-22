import nodemailer from 'nodemailer';

// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM 이 있으면 메일 발송 사용
let transport = null;
export function mailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}
export async function sendMail(to, subject, text) {
  if (!mailConfigured()) throw new Error('mail not configured');
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
}
