import { google } from "googleapis";
import type { CalendarEvent, CalendarSlot } from "./calendar";
import { getOrder } from "./orders";
import { filterPickupSlotWindows, getPickupSlotWindows } from "./pickup-slots";

const timeZone = process.env.GOOGLE_CALENDAR_TIME_ZONE ?? "Asia/Kolkata";

export function isGoogleCalendarConfigured() {
  const hasKeyFile = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE);
  return Boolean(
    (hasKeyFile || (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)) &&
    process.env.GOOGLE_CALENDAR_ID
  );
}

function getCalendarClient() {
  const auth = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
    ? new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
        scopes: ["https://www.googleapis.com/auth/calendar"]
      })
    : new google.auth.JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        scopes: ["https://www.googleapis.com/auth/calendar"]
      });
  return google.calendar({ version: "v3", auth });
}

function getSlotWindows() {
  return getPickupSlotWindows().map((slot) => ({ ...slot, slotId: slot.slotId.replace("pickup-", "google-") }));
}

export async function getGoogleAvailableSlots(preference?: string, date?: string, startTime?: string): Promise<CalendarSlot[]> {
  const calendar = getCalendarClient();
  const windows = filterPickupSlotWindows(getSlotWindows(), preference, date, startTime);
  if (!windows.length) return [];

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: new Date().toISOString(),
      timeMax: windows.at(-1)?.end.toISOString(),
      items: [{ id: process.env.GOOGLE_CALENDAR_ID }]
    }
  });
  const busy = response.data.calendars?.[process.env.GOOGLE_CALENDAR_ID ?? ""]?.busy ?? [];

  return windows
    .filter((slot) => !busy.some((period) => {
      const busyStart = period.start ? new Date(period.start).getTime() : 0;
      const busyEnd = period.end ? new Date(period.end).getTime() : 0;
      return slot.start.getTime() < busyEnd && slot.end.getTime() > busyStart;
    }))
    .map(({ slotId, label, preference }) => ({ slotId, label, preference }));
}

export async function createGooglePickupEvent(orderId: string, slotId: string) {
  const order = await getOrder(orderId);
  if (!order) return { created: false, reason: "No order found with that ID." };
  const slot = getSlotWindows().find((item) => item.slotId === slotId);
  if (!slot) return { created: false, reason: "That pickup slot does not exist." };

  const available = await getGoogleAvailableSlots();
  if (!available.some((item) => item.slotId === slotId)) {
    return { created: false, reason: "That pickup slot is no longer available." };
  }

  const response = await getCalendarClient().events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: {
      summary: `Return pickup - Order #${orderId}`,
      description: `Return pickup for ${order.customerName}. Order ID: ${orderId}`,
      extendedProperties: { private: { orderId, type: "PICKUP" } },
      start: { dateTime: slot.start.toISOString(), timeZone },
      end: { dateTime: slot.end.toISOString(), timeZone }
    }
  });

  return {
    created: true,
    event: {
      id: response.data.id ?? `GOOGLE-${Date.now()}`,
      orderId,
      customerName: order.customerName,
      slotId,
      slotLabel: slot.label,
      type: "PICKUP" as const,
      status: "SCHEDULED" as const,
      createdAt: new Date().toISOString()
    }
  };
}

export async function listGoogleCalendarEvents(): Promise<CalendarEvent[]> {
  const response = await getCalendarClient().events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: new Date().toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    privateExtendedProperty: ["type=PICKUP"]
  });

  return (response.data.items ?? []).map((event) => ({
    id: event.id ?? `GOOGLE-${Date.now()}`,
    orderId: event.extendedProperties?.private?.orderId ?? "",
    customerName: event.description?.split(". ")[0]?.replace("Return pickup for ", "") ?? "",
    slotId: event.id ?? "",
    slotLabel: event.start?.dateTime ?? "",
    type: "PICKUP" as const,
    status: "SCHEDULED" as const,
    createdAt: event.created ?? new Date().toISOString()
  }));
}

export async function getGooglePickupStatus(orderId: string) {
  const events = await listGoogleCalendarEvents();
  return events.filter((event) => event.orderId === orderId).at(-1) ?? null;
}
