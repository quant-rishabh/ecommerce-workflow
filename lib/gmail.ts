import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

const tokenPath = path.join(process.cwd(), "data", "gmail-token.json");
const scope = "https://www.googleapis.com/auth/gmail.send";

type OAuthConfig = {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
};

type GmailToken = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
};

async function getOAuthConfig(): Promise<OAuthConfig> {
  const file = process.env.GOOGLE_GMAIL_OAUTH_CLIENT_FILE;
  if (!file) throw new Error("GOOGLE_GMAIL_OAUTH_CLIENT_FILE is not configured.");
  const raw = JSON.parse(await readFile(file, "utf8")) as { web?: OAuthConfig; installed?: OAuthConfig };
  const config = raw.web ?? raw.installed;
  if (!config) throw new Error("The Gmail OAuth client file has no web or installed configuration.");
  return config;
}

export async function getGmailOAuthClient() {
  const config = await getOAuthConfig();
  return new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    process.env.GOOGLE_GMAIL_REDIRECT_URI ?? "http://localhost:3001/api/auth/google/callback"
  );
}

export async function getGmailAuthorizationUrl() {
  const client = await getGmailOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [scope]
  });
}

export async function saveGmailAuthorization(code: string) {
  const client = await getGmailOAuthClient();
  const { tokens } = await client.getToken(code);
  await writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
  return tokens;
}

export async function sendGmailEmail(input: { to: string; subject: string; body: string; orderId: string }) {
  const token = JSON.parse(await readFile(tokenPath, "utf8")) as GmailToken;
  const client = await getGmailOAuthClient();
  client.setCredentials(token);
  const gmail = google.gmail({ version: "v1", auth: client });
  const message = [
    `To: ${input.to}`,
    "Content-Type: text/plain; charset=utf-8",
    `Subject: ${input.subject}`,
    "",
    input.body
  ].join("\r\n");
  const raw = Buffer.from(message).toString("base64url");
  const response = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  return {
    id: response.data.id ?? `EMAIL-${Date.now()}`,
    to: input.to,
    subject: input.subject,
    body: input.body,
    orderId: input.orderId,
    status: "SENT_GMAIL" as const,
    sentAt: new Date().toISOString()
  };
}

export async function isGmailAuthorized() {
  try {
    const token = JSON.parse(await readFile(tokenPath, "utf8")) as GmailToken;
    return Boolean(token.refresh_token || token.access_token);
  } catch {
    return false;
  }
}
