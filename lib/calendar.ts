import { getOrder } from "./orders";
import { filterPickupSlotWindows, getPickupSlotWindows } from "./pickup-slots";
import { supabaseAdmin } from "./supabase-admin";
import {
  createGooglePickupEvent,
  getGoogleAvailableSlots,
  getGooglePickupStatus,
  isGoogleCalendarConfigured,
  listGoogleCalendarEvents
} from "./google-calendar";

export type CalendarSlot = {
  slotId: string;
  label: string;
  preference: string;
};

export type CalendarEvent = {
  id: string;
  orderId: string;
  customerName: string;
  slotId: string;
  slotLabel: string;
  type: "PICKUP";
  status: "SCHEDULED";
  createdAt: string;
};

function mapEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    orderId: row.order_id,
    customerName: row.customer_name,
    slotId: row.slot_id,
    slotLabel: row.slot_label,
    type: row.type,
    status: row.status,
    createdAt: row.created_at
  };
}

export async function getAvailableSlots(preference?: string, date?: string, startTime?: string): Promise<CalendarSlot[]> {
  if (isGoogleCalendarConfigured()) return getGoogleAvailableSlots(preference, date, startTime);
  const slots = getPickupSlotWindows();
  const { data: eventRows, error } = await supabaseAdmin.from("calendar_events").select("slot_id, slot_label");
  if (error) throw error;
  const events = eventRows ?? [];
  const availableSlots = filterPickupSlotWindows(slots, preference, date, startTime);
  return availableSlots
    .filter((slot) => !events.some((event) => event.slot_id === slot.slotId || event.slot_label === slot.label))
    .map(({ slotId, label, preference: slotPreference }) => ({ slotId, label, preference: slotPreference }));
}

export async function createPickupEvent(orderId: string, slotId: string) {
  if (isGoogleCalendarConfigured()) return createGooglePickupEvent(orderId, slotId);
  const order = await getOrder(orderId);
  if (!order) return { created: false, reason: "No order found with that ID." };

  const slots = getPickupSlotWindows();
  const slot = slots.find((item) => item.slotId === slotId);
  if (!slot) return { created: false, reason: "That pickup slot does not exist." };

  const { data: events, error: eventsError } = await supabaseAdmin.from("calendar_events").select("slot_id, slot_label");
  if (eventsError) throw eventsError;
  if ((events ?? []).some((event) => event.slot_id === slotId || event.slot_label === slot.label)) {
    return { created: false, reason: "That pickup slot is no longer available." };
  }

  const event: CalendarEvent = {
    id: `CAL-${Date.now()}`,
    orderId,
    customerName: order.customerName,
    slotId,
    slotLabel: slot.label,
    type: "PICKUP",
    status: "SCHEDULED",
    createdAt: new Date().toISOString()
  };

  const { error } = await supabaseAdmin.from("calendar_events").insert({
    id: event.id,
    order_id: event.orderId,
    customer_name: event.customerName,
    slot_id: event.slotId,
    slot_label: event.slotLabel,
    type: event.type,
    status: event.status,
    created_at: event.createdAt
  });
  if (error) throw error;
  return { created: true, event };
}

export async function listCalendarEvents(): Promise<CalendarEvent[]> {
  if (isGoogleCalendarConfigured()) return listGoogleCalendarEvents();
  const { data, error } = await supabaseAdmin.from("calendar_events").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapEvent);
}

export async function getPickupStatus(orderId: string): Promise<CalendarEvent | null> {
  if (isGoogleCalendarConfigured()) return getGooglePickupStatus(orderId);
  const { data, error } = await supabaseAdmin
    .from("calendar_events")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapEvent(data) : null;
}
