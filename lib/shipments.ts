import { supabaseAdmin } from "./supabase-admin";

export type Shipment = {
  orderId: string;
  carrier: string;
  trackingStatus: string;
  currentLocation: string;
  estimatedArrival: string;
  delayMinutes?: number;
};

export async function getShipment(orderId: string): Promise<Shipment | null> {
  const { data, error } = await supabaseAdmin
    .from("shipments")
    .select("order_id, carrier, tracking_status, current_location, estimated_arrival, delay_minutes")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    orderId: data.order_id,
    carrier: data.carrier,
    trackingStatus: data.tracking_status,
    currentLocation: data.current_location,
    estimatedArrival: data.estimated_arrival,
    delayMinutes: data.delay_minutes ?? undefined
  };
}
