import nodemailer from 'nodemailer';

/** SMTP_URL 이 설정된 경우에만 실제 발송. 없으면 false 반환(앱에 "메일 미발송"으로 표시). */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const url = process.env.SMTP_URL;
  if (!url) { console.warn(`[mail] SMTP_URL not set — mail to ${to} not sent`); return false; }
  try {
    await nodemailer.createTransport(url).sendMail({ from: process.env.MAIL_FROM ?? 'NotePro <no-reply@notepro.app>', to, subject, text });
    return true;
  } catch (e) {
    console.error('[mail] send failed', e);
    return false;
  }
}
