import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const envText = await readFile(".env.local", "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/g, "")];
    })
);

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const readJson = async (file) => JSON.parse(await readFile(`data/${file}`, "utf8"));
const migrate = async (table, rows, conflict = "id") => {
  if (!rows.length) return 0;
  const { error } = await client.from(table).upsert(rows, { onConflict: conflict });
  if (error) throw error;
  return rows.length;
};

const orders = await readJson("orders.json");
const shipments = await readJson("shipments.json");
const returns = await readJson("returns.json");
const refunds = await readJson("refunds.json");
const approvals = await readJson("approval-requests.json");
const compensation = await readJson("compensation-requests.json");
const emails = await readJson("email-outbox.json");
const calendarEvents = await readJson("calendar-events.json");

const counts = {};
counts.orders = await migrate("orders", orders.map((item) => ({
  id: item.id,
  customer_id: item.customerId,
  customer_name: item.customerName,
  email: item.email,
  status: item.status,
  delivered_at: item.deliveredAt ?? null,
  expected_delivery: item.expectedDelivery,
  items: item.items,
  total_amount: item.totalAmount,
  currency: item.currency
})));
counts.shipments = await migrate("shipments", shipments.map((item) => ({
  order_id: item.orderId,
  carrier: item.carrier,
  tracking_status: item.trackingStatus,
  current_location: item.currentLocation,
  estimated_arrival: item.estimatedArrival,
  delay_minutes: item.delayMinutes ?? 0
})), "order_id");
counts.returns = await migrate("returns", returns.map((item) => ({
  id: item.id,
  order_id: item.orderId,
  customer_name: item.customerName,
  status: item.status,
  created_at: item.createdAt
})));
counts.refunds = await migrate("refunds", refunds.map((item) => ({
  id: item.id,
  order_id: item.orderId,
  amount: item.amount,
  currency: item.currency,
  reason: item.reason,
  status: item.status,
  created_at: item.createdAt
})));
counts.approvals = await migrate("approval_requests", approvals.map((item) => ({
  id: item.id,
  type: item.type,
  order_id: item.orderId,
  customer_name: item.customerName,
  amount: item.amount,
  currency: item.currency,
  reason: item.reason,
  status: item.status,
  created_at: item.createdAt,
  decided_at: item.decidedAt ?? null
})));
counts.compensation = await migrate("compensation_requests", compensation.map((item) => ({
  id: item.id,
  order_id: item.orderId,
  amount: item.amount,
  currency: item.currency,
  reason: item.reason,
  status: item.status,
  created_at: item.createdAt
})));
counts.emails = await migrate("email_outbox", emails.map((item) => ({
  id: item.id,
  to_email: item.to,
  subject: item.subject,
  body: item.body,
  order_id: item.orderId,
  status: item.status,
  sent_at: item.sentAt
})));
counts.calendarEvents = await migrate("calendar_events", calendarEvents.map((item) => ({
  id: item.id,
  order_id: item.orderId,
  customer_name: item.customerName,
  slot_id: item.slotId,
  slot_label: item.slotLabel,
  type: item.type,
  status: item.status,
  created_at: item.createdAt
})));

console.log(JSON.stringify(counts));
