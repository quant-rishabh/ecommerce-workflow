import { listCalendarEvents } from "../../../../lib/calendar";

export async function GET() {
  return Response.json({ events: await listCalendarEvents() });
}
