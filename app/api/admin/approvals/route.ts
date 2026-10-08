import { decideApproval, listApprovals } from "../../../../lib/approvals";

export async function GET() {
  return Response.json({ approvals: await listApprovals() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string; action?: "approve" | "reject" };

  if (!body.id || !body.action) {
    return Response.json({ error: "Approval ID and action are required." }, { status: 400 });
  }

  const status = body.action === "approve" ? "APPROVED" : body.action === "reject" ? "REJECTED" : null;
  if (!status) {
    return Response.json({ error: "Action must be approve or reject." }, { status: 400 });
  }

  const approval = await decideApproval(body.id, status);
  if (!approval) {
    return Response.json({ error: "Approval request not found." }, { status: 404 });
  }

  return Response.json({ approval });
}
