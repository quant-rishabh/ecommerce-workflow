import { supabaseAdmin } from "../../../lib/supabase-admin";

export async function GET() {
  const [ordersResult, shipmentsResult] = await Promise.all([
    supabaseAdmin.from("orders").select("id, customer_id, customer_name, email, status, delivered_at, expected_delivery, items, total_amount, currency").order("id"),
    supabaseAdmin.from("shipments").select("order_id, carrier, tracking_status, current_location, estimated_arrival, delay_minutes")
  ]);

  if (ordersResult.error) return Response.json({ error: ordersResult.error.message }, { status: 500 });
  if (shipmentsResult.error) return Response.json({ error: shipmentsResult.error.message }, { status: 500 });

  return Response.json({
    orders: (ordersResult.data ?? []).map((order) => ({
      id: order.id,
      customerId: order.customer_id,
      customerName: order.customer_name,
      email: order.email,
      status: order.status,
      deliveredAt: order.delivered_at,
      expectedDelivery: order.expected_delivery,
      items: order.items,
      totalAmount: Number(order.total_amount),
      currency: order.currency
    })),
    shipments: (shipmentsResult.data ?? []).map((shipment) => ({
      orderId: shipment.order_id,
      carrier: shipment.carrier,
      trackingStatus: shipment.tracking_status,
      currentLocation: shipment.current_location,
      estimatedArrival: shipment.estimated_arrival,
      delayMinutes: shipment.delay_minutes
    }))
  });
}
