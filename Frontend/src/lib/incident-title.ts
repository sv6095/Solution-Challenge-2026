function compact(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstSentence(value: string, maxLen = 96): string {
  const text = compact(value);
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen - 1).trimEnd()}…`;
}

function looksCodeLikeTitle(title: string): boolean {
  const t = compact(title);
  if (!t) return true;
  const hasSpace = /\s/.test(t);
  if (hasSpace) return false;
  if (t.length <= 14) return true;
  if (/^[A-Z0-9]+(?:[-_][A-Z0-9]+)+$/.test(t)) return true;
  if (/^[A-Z]{3,}\d{1,4}$/.test(t)) return true;
  return false;
}

export function incidentDisplayTitle(incident: Record<string, unknown>): string {
  const rawTitle = compact(incident.event_title || incident.title);
  const description = compact(incident.event_description || incident.description);
  const eventType = compact(incident.event_type || incident.source_category || "Disruption");
  const location = compact(incident.location || incident.region || incident.country);
  const contextual = firstSentence(description, 104);

  if (!looksCodeLikeTitle(rawTitle)) return rawTitle;
  if (contextual) return location ? `${contextual} (${location})` : contextual;
  if (location) return `${eventType} in ${location}`;
  if (rawTitle) return `${eventType}: ${rawTitle}`;
  return "Supply chain disruption";
}

export function incidentContextTag(incident: Record<string, unknown>): string {
  const rawTitle = compact(incident.event_title || incident.title);
  const description = compact(incident.event_description || incident.description);
  if (!rawTitle || !looksCodeLikeTitle(rawTitle)) return "";
  const context = firstSentence(description, 64);
  return context || rawTitle;
}
