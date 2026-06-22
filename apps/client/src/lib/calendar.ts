function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function toICSDate(iso: string) {
  const d = new Date(iso);
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeICS(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function addToCalendar(opts: {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  description?: string | null;
  location?: string | null;
}) {
  const now = toICSDate(new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CLUB 40//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${opts.id}@club40`,
    `DTSTAMP:${now}`,
    `DTSTART:${toICSDate(opts.startsAt)}`,
    `DTEND:${toICSDate(opts.endsAt)}`,
    `SUMMARY:${escapeICS(opts.title)}`,
  ];
  if (opts.description) lines.push(`DESCRIPTION:${escapeICS(opts.description)}`);
  if (opts.location) lines.push(`LOCATION:${escapeICS(opts.location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  const ics = lines.join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${opts.title.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
