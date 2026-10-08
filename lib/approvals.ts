import { getOrder } from "./orders";
import { checkPolicy } from "./policies";
import { supabaseAdmin } from "./supabase-admin";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ApprovalRequest = {
  id: string;
  type: "REFUND";
  orderId: string;
  customerName: string;
  amount: number;
  currency: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
};

function mapApproval(row: any): ApprovalRequest {
  return {
    id: row.id,
    type: row.type,
    orderId: row.order_id,
    customerName: row.customer_name,
    amount: Number(row.amount),
    currency: row.currency,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined
  };
}

export async function listApprovals(): Promise<ApprovalRequest[]> {
  const { data, error } = await supabaseAdmin.from("approval_requests").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapApproval);
}

export async function getApprovalStatus(orderId: string): Promise<ApprovalRequest | null> {
  const { data, error } = await supabaseAdmin
    .from("approval_requests")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapApproval(data) : null;
}

export async function requestRefundApproval(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) {
    return { created: false, reason: "No order found with that ID." };
  }

  const policy = checkPolicy({ issueType: "REFUND", orderAmount: order.totalAmount });
  if (!policy.eligible) {
    return { created: false, reason: policy.reason };
  }

  if (policy.requiresApproval !== true) {
    return { created: false, reason: "This refund is within the automatic refund limit and does not require approval." };
  }

  const existing = await getApprovalStatus(orderId);
  if (existing && (existing.status === "PENDING" || existing.status === "APPROVED")) {
    return { created: false, reason: `A refund approval for this order is already ${existing.status.toLowerCase()}.`, approval: existing };
  }

  const approval: ApprovalRequest = {
    id: `AP-${Date.now()}`,
    type: "REFUND",
    orderId,
    customerName: order.customerName,
    amount: order.totalAmount,
    currency: order.currency,
    reason: policy.reason,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };

  const { error } = await supabaseAdmin.from("approval_requests").insert({
    id: approval.id,
    type: approval.type,
    order_id: approval.orderId,
    customer_name: approval.customerName,
    amount: approval.amount,
    currency: approval.currency,
    reason: approval.reason,
    status: approval.status,
    created_at: approval.createdAt
  });
  if (error) throw error;
  return { created: true, approval };
}

export async function decideApproval(id: string, status: Exclude<ApprovalStatus, "PENDING">) {
  const existing = await supabaseAdmin.from("approval_requests").select("*").eq("id", id).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) return null;
  if (existing.data.status !== "PENDING") return mapApproval(existing.data);
  const { data, error } = await supabaseAdmin
    .from("approval_requests")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return mapApproval(data);
}
