const STALE_INCIDENT_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_EVENT_MS = 30 * 24 * 60 * 60 * 1000;

const GDACS_FROM_RE = /from:\s*(\d{1,2}\s+\w{3}\s+\d{4})/i;

function parseGdacsTitleDate(title: string): number | null {
  const match = title.match(GDACS_FROM_RE);
  if (!match) return null;
  const ts = Date.parse(match[1]);
  return Number.isNaN(ts) ? null : ts;
}

/** Returns true when an incident is still active/relevant for dashboard views. */
export function isFreshIncident(inc: Record<string, unknown>): boolean {
  const eventDt = inc.event_time || inc.event_date;
  if (eventDt) {
    if (Date.now() - new Date(String(eventDt)).getTime() > STALE_EVENT_MS) return false;
  } else {
    const title = String(inc.event_title || inc.title || "");
    const gdacsTs = parseGdacsTitleDate(title);
    if (gdacsTs !== null && Date.now() - gdacsTs > STALE_EVENT_MS) return false;
  }
  const dt = inc.detected_at || inc.created_at || inc.timestamp;
  if (dt && Date.now() - new Date(String(dt)).getTime() > STALE_INCIDENT_MS) return false;
  return true;
}

export function filterFreshIncidents<T extends Record<string, unknown>>(incidents: T[]): T[] {
  return incidents.filter(isFreshIncident);
}
