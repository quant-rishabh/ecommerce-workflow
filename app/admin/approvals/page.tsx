"use client";

import { useEffect, useState } from "react";

type Approval = {
  id: string;
  type: "REFUND";
  orderId: string;
  customerName: string;
  amount: number;
  currency: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  decidedAt?: string;
};

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadApprovals() {
    const response = await fetch("/api/admin/approvals", { cache: "no-store" });
    const data = (await response.json()) as { approvals?: Approval[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load approvals.");
    setApprovals(data.approvals ?? []);
  }

  useEffect(() => {
    loadApprovals().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  async function decide(id: string, action: "approve" | "reject") {
    setError("");
    const response = await fetch("/api/admin/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action })
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not update approval.");
      return;
    }
    await loadApprovals();
  }

  return (
    <main className="admin-shell">
      <section className="admin-panel">
        <header>
          <p className="eyebrow">ADMIN / APPROVALS</p>
          <h1>Approval queue</h1>
          <p className="subtitle">Review requests before sensitive actions are processed.</p>
        </header>

        <div className="admin-content">
          {loading && <p className="admin-message">Loading approvals...</p>}
          {error && <p className="admin-error">{error}</p>}
          {!loading && approvals.length === 0 && <p className="admin-message">No approval requests yet.</p>}
          {approvals.map((approval) => (
            <article className="approval-row" key={approval.id}>
              <div>
                <strong>{approval.type} / Order #{approval.orderId}</strong>
                <p>{approval.customerName} · {approval.amount} {approval.currency}</p>
                <p>{approval.reason}</p>
                <small>{approval.id} · {approval.status}</small>
              </div>
              {approval.status === "PENDING" && (
                <div className="approval-actions">
                  <button type="button" onClick={() => decide(approval.id, "approve")}>Approve</button>
                  <button type="button" onClick={() => decide(approval.id, "reject")}>Reject</button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
