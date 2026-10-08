import { getOrder } from "./orders";
import { checkPolicy } from "./policies";
import { getShipment } from "./shipments";
import { supabaseAdmin } from "./supabase-admin";

type CompensationRequest = {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  reason: string;
  status: "SUBMITTED";
  createdAt: string;
};

export async function requestCompensation(orderId: string): Promise<CompensationRequest | { submitted: false; reason: string }> {
  const order = await getOrder(orderId);
  const shipment = await getShipment(orderId);

  if (!order) {
    return { submitted: false, reason: "No order found with that ID." };
  }

  if (!shipment?.delayMinutes) {
    return { submitted: false, reason: "No qualifying delivery delay was found." };
  }

  const policyResult = checkPolicy({
    issueType: "DELIVERY_DELAY",
    delayMinutes: shipment.delayMinutes,
    orderAmount: order.totalAmount
  });

  if (!policyResult.eligible) {
    return { submitted: false, reason: policyResult.reason };
  }

  if (typeof policyResult.compensationAmount !== "number" || typeof policyResult.currency !== "string") {
    return { submitted: false, reason: "The compensation policy did not provide a valid amount." };
  }

  const request: CompensationRequest = {
    id: `CP-${Date.now()}`,
    orderId,
    amount: policyResult.compensationAmount,
    currency: policyResult.currency,
    reason: policyResult.reason,
    status: "SUBMITTED",
    createdAt: new Date().toISOString()
  };

  const { error } = await supabaseAdmin.from("compensation_requests").insert({
    id: request.id,
    order_id: request.orderId,
    amount: request.amount,
    currency: request.currency,
    reason: request.reason,
    status: request.status,
    created_at: request.createdAt
  });
  if (error) throw error;

  return request;
}
