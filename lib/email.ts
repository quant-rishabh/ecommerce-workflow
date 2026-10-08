import { isGmailAuthorized, sendGmailEmail } from "./gmail";
import { supabaseAdmin } from "./supabase-admin";

type EmailRecord = {
  id: string;
  to: string;
  subject: string;
  body: string;
  orderId: string;
  status: "SENT_MOCK";
  sentAt: string;
};

export async function sendMockEmail(input: Omit<EmailRecord, "id" | "status" | "sentAt">) {
  const email: EmailRecord = {
    ...input,
    id: `EMAIL-${Date.now()}`,
    status: "SENT_MOCK",
    sentAt: new Date().toISOString()
  };

  const { error } = await supabaseAdmin.from("email_outbox").insert({
    id: email.id,
    to_email: email.to,
    subject: email.subject,
    body: email.body,
    order_id: email.orderId,
    status: email.status,
    sent_at: email.sentAt
  });
  if (error) throw error;
  return email;
}

export async function sendEmail(input: Omit<EmailRecord, "id" | "status" | "sentAt">) {
  if (process.env.GOOGLE_GMAIL_OAUTH_CLIENT_FILE && await isGmailAuthorized()) {
    return sendGmailEmail(input);
  }
  return sendMockEmail(input);
}
