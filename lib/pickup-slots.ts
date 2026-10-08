export type PickupSlotWindow = {
  slotId: string;
  label: string;
  preference: string;
  start: Date;
  end: Date;
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function getPickupSlotWindows(now = new Date()): PickupSlotWindow[] {
  const slots: PickupSlotWindow[] = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    for (let startHour = 8; startHour < 23; startHour += 1) {
      const start = new Date(now);
      start.setDate(now.getDate() + dayOffset);
      start.setHours(startHour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(startHour + 1, 0, 0, 0);
      if (end <= now) continue;

      const dayLabel = start.toLocaleDateString("en-IN", {
        weekday: "long",
        month: "short",
        day: "numeric"
      });
      slots.push({
        slotId: `pickup-${start.toISOString()}`,
        label: `${dayLabel}, ${formatTime(start)} - ${formatTime(end)}`,
        preference: `day_${dayOffset}`,
        start,
        end
      });
    }
  }

  return slots;
}

export function filterPickupSlotWindows(
  slots: PickupSlotWindow[],
  preference?: string,
  date?: string,
  startTime?: string
) {
  const requestedHour = startTime ? Number(startTime.split(":")[0]) : undefined;
  const requestedMinute = startTime ? Number(startTime.split(":")[1] ?? 0) : undefined;

  return slots.filter((slot) => {
    const matchesPreference = !preference
      || slot.preference === preference
      || (preference === "today" && slot.preference === "day_0")
      || (preference === "tomorrow" && slot.preference === "day_1")
      || (preference === "today_evening" && slot.preference === "day_0" && slot.start.getHours() >= 18)
      || (preference === "tomorrow_morning" && slot.preference === "day_1" && slot.start.getHours() < 12)
      || (preference === "tomorrow_afternoon" && slot.preference === "day_1" && slot.start.getHours() >= 12 && slot.start.getHours() < 18);
    const matchesDate = !date || dateKey(slot.start) === date;
    const matchesTime = requestedHour === undefined
      || (slot.start.getHours() === requestedHour && slot.start.getMinutes() === requestedMinute);
    return matchesPreference && matchesDate && matchesTime;
  });
}
