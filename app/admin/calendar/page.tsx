"use client";

import { useEffect, useState } from "react";

type CalendarEvent = {
  id: string;
  orderId: string;
  customerName: string;
  slotLabel: string;
  type: "PICKUP";
  status: "SCHEDULED";
  createdAt: string;
};

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/calendar", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { events?: CalendarEvent[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not load calendar.");
        setEvents(data.events ?? []);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  return (
    <main className="admin-shell">
      <section className="admin-panel">
        <header>
          <p className="eyebrow">OPERATIONS / CALENDAR</p>
          <h1>Pickup calendar</h1>
          <p className="subtitle">Mock operations calendar for scheduled pickups.</p>
        </header>
        <div className="admin-content">
          {error && <p className="admin-error">{error}</p>}
          {!error && events.length === 0 && <p className="admin-message">No pickups scheduled yet.</p>}
          {events.map((event) => (
            <article className="approval-row" key={event.id}>
              <div>
                <strong>{event.type} / Order #{event.orderId}</strong>
                <p>{event.customerName} · {event.slotLabel}</p>
                <small>{event.id} · {event.status}</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
