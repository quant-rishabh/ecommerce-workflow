import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOrder, updateOrderStatus } from "./orders";
import { checkPolicy } from "./policies";
import { sendEmail } from "./email";
import { supabaseAdmin } from "./supabase-admin";

const refundsPath = path.join(process.cwd(), "data", "refunds.json");

type Refund = {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  reason: string;
  status: "PROCESSED";
  createdAt: string;
};

type ReturnRequest = {
  id: string;
  orderId: string;
  customerName: string;
  status: "RETURN_REQUESTED" | "PICKUP_SCHEDULED";
  createdAt: string;
};

export async function cancelOrder(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) return { cancelled: false, reason: "No order found with that ID." };

  const policy = checkPolicy({ issueType: "CANCELLATION", orderStatus: order.status });
  if (!policy.eligible) return { cancelled: false, reason: policy.reason };

  await updateOrderStatus(orderId, "CANCELLED");
  const refunds = JSON.parse(await readFile(refundsPath, "utf8")) as Refund[];
  const refund: Refund = {
    id: `REF-${Date.now()}`,
    orderId,
    amount: order.totalAmount,
    currency: order.currency,
    reason: "Automatic refund after order cancellation.",
    status: "PROCESSED",
    createdAt: new Date().toISOString()
  };
  refunds.push(refund);
  await writeFile(refundsPath, `${JSON.stringify(refunds, null, 2)}\n`, "utf8");

  const email = order.email
    ? await sendEmail({
        to: order.email,
        subject: `Order #${orderId} cancelled`,
        body: `Your order has been cancelled and your refund of ${order.totalAmount} ${order.currency} has been processed.`,
        orderId
      })
    : null;

  return { cancelled: true, orderStatus: "CANCELLED", refund, email: email ? { status: email.status, to: email.to } : null };
}

export async function requestReturn(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) return { requested: false, reason: "No order found with that ID." };

  const policy = checkPolicy({ issueType: "RETURN" });
  if (!policy.eligible) return { requested: false, reason: policy.reason };
  if (order.status !== "DELIVERED") {
    const cancellationPolicy = checkPolicy({ issueType: "CANCELLATION", orderStatus: order.status });
    return {
      requested: false,
      reason: cancellationPolicy.eligible
        ? "A return can be requested after delivery. This order can still be cancelled instead."
        : "A return can be requested after delivery, and this order can no longer be cancelled because it is already in transit.",
      suggestedAction: cancellationPolicy.eligible ? "CANCEL_ORDER" : "NO_ACTION_AVAILABLE"
    };
  }

  const returnWindowDays = checkPolicy({ issueType: "RETURN" }).returnWindowDays ?? 30;
  const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : null;
  const daysSinceDelivery = deliveredAt
    ? Math.floor((Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  if (daysSinceDelivery !== null && daysSinceDelivery > returnWindowDays) {
    return {
      requested: false,
      reason: `This order was delivered ${daysSinceDelivery} days ago. The ${returnWindowDays}-day return window has expired.`,
      suggestedAction: "NO_ACTION_AVAILABLE"
    };
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("returns")
    .select("id, order_id, customer_name, status, created_at")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const reason = existing.status === "PICKUP_SCHEDULED"
      ? "A return pickup is already scheduled for this order."
      : "A return request already exists for this order.";
    return {
      requested: false,
      reason,
      returnRequest: {
        id: existing.id,
        orderId: existing.order_id,
        customerName: existing.customer_name,
        status: existing.status,
        createdAt: existing.created_at
      }
    };
  }

  const returnRequest: ReturnRequest = {
    id: `RET-${Date.now()}`,
    orderId,
    customerName: order.customerName,
    status: "RETURN_REQUESTED",
    createdAt: new Date().toISOString()
  };
  const { error: insertError } = await supabaseAdmin.from("returns").insert({
    id: returnRequest.id,
    order_id: returnRequest.orderId,
    customer_name: returnRequest.customerName,
    status: returnRequest.status,
    created_at: returnRequest.createdAt
  });
  if (insertError) throw insertError;
  return { requested: true, returnRequest };
}

export async function markReturnPickupScheduled(orderId: string) {
  const { data: returnRequest, error } = await supabaseAdmin
    .from("returns")
    .update({ status: "PICKUP_SCHEDULED" })
    .eq("order_id", orderId)
    .eq("status", "RETURN_REQUESTED")
    .select("id, order_id, customer_name, status, created_at")
    .maybeSingle();
  if (error) throw error;
  if (!returnRequest) return null;
  return {
    id: returnRequest.id,
    orderId: returnRequest.order_id,
    customerName: returnRequest.customer_name,
    status: returnRequest.status,
    createdAt: returnRequest.created_at
  };
}
