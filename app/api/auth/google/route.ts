import { getGmailAuthorizationUrl } from "../../../../lib/gmail";

export async function GET() {
  try {
    const url = await getGmailAuthorizationUrl();
    return Response.redirect(url);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not start Gmail authorization." }, { status: 500 });
  }
}
