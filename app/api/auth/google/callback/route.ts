import { saveGmailAuthorization } from "../../../../../lib/gmail";

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");
  const error = new URL(request.url).searchParams.get("error");
  if (error) return Response.json({ error: `Google authorization failed: ${error}` }, { status: 400 });
  if (!code) return Response.json({ error: "Google authorization code is missing." }, { status: 400 });

  try {
    await saveGmailAuthorization(code);
    return Response.redirect(new URL("/?gmail=connected", request.url));
  } catch (authorizationError) {
    return Response.json(
      { error: authorizationError instanceof Error ? authorizationError.message : "Could not save Gmail authorization." },
      { status: 500 }
    );
  }
}
