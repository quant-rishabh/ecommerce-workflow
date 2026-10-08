import { supabaseAdmin } from "./supabase-admin";

export type Order = {
  id: string;
  customerId: string;
  customerName: string;
  email: string;
  status: string;
  deliveredAt?: string;
  expectedDelivery: string;
  items: { name: string; quantity: number }[];
  totalAmount: number;
  currency: string;
};

export async function getOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, customer_id, customer_name, email, status, delivered_at, expected_delivery, items, total_amount, currency")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    customerId: data.customer_id,
    customerName: data.customer_name,
    email: data.email,
    status: data.status,
    deliveredAt: data.delivered_at ?? undefined,
    expectedDelivery: data.expected_delivery,
    items: data.items,
    totalAmount: Number(data.total_amount),
    currency: data.currency
  };
}

export async function updateOrderStatus(orderId: string, status: string) {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .select("id, customer_id, customer_name, email, status, delivered_at, expected_delivery, items, total_amount, currency")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return getOrder(data.id);
}