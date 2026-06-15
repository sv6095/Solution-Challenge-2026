function compact(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstSentence(value: string, maxLen = 96): string {
  const text = compact(value);
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen - 3).trimEnd()}...`;
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

function titleCase(value: string): string {
  return compact(value)
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function extractNamedPlace(text: string): string {
  const source = compact(text);
  if (!source) return "";
  const patterns = [
    /\b(Strait of [A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2})\b/,
    /\b([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2}\s+Strait)\b/,
    /\b([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2}\s+Canal)\b/,
    /\b(Gulf of [A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2})\b/,
    /\b([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2}\s+Port)\b/,
  ];
  for (const re of patterns) {
    const match = source.match(re);
    if (match?.[1]) return match[1];
  }
  return "";
}

function codeTokenPlace(rawTitle: string): string {
  const title = compact(rawTitle);
  if (!title || !looksCodeLikeTitle(title)) return "";
  const head = title.split(/[-_]/)[0] || "";
  const cleaned = head.replace(/\d+/g, "");
  if (!cleaned || cleaned.length < 3) return "";
  return titleCase(cleaned);
}

function inferPlace(rawTitle: string, description: string, location: string): string {
  const fromLocation = extractNamedPlace(location);
  if (fromLocation) return fromLocation;
  const fromDescription = extractNamedPlace(description);
  if (fromDescription) return fromDescription;
  if (location && location.toLowerCase() !== "global") return titleCase(location);
  const fromCode = codeTokenPlace(rawTitle);
  if (fromCode) return fromCode;
  return "";
}

function formatEventType(value: string): string {
  const t = compact(value).toLowerCase();
  if (!t) return "Disruption";
  if (t.includes("maritime") || t.includes("chokepoint") || t.includes("portwatch")) {
    return "Maritime disruption";
  }
  return t
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function incidentDisplayTitle(incident: Record<string, unknown>): string {
  const rawTitle = compact(incident.event_title || incident.title);
  const description = compact(incident.event_description || incident.description);
  const eventType = compact(incident.event_type || incident.source_category || "Disruption");
  const location = compact(incident.location || incident.region || incident.country);
  const contextual = firstSentence(description, 104);
  const place = inferPlace(rawTitle, description, location);
  const eventLabel = formatEventType(eventType);

  if (!looksCodeLikeTitle(rawTitle)) return rawTitle;
  if (contextual && place && contextual.toLowerCase().includes(place.toLowerCase())) return contextual;
  if (place) return `${eventLabel} at ${place}`;
  if (contextual) return contextual;
  if (rawTitle) return `${eventLabel}: ${rawTitle}`;
  return "Supply chain disruption";
}

export function incidentContextTag(incident: Record<string, unknown>): string {
  const rawTitle = compact(incident.event_title || incident.title);
  const description = compact(incident.event_description || incident.description);
  const location = compact(incident.location || incident.region || incident.country);
  if (!rawTitle || !looksCodeLikeTitle(rawTitle)) return "";
  const place = inferPlace(rawTitle, description, location);
  if (place) return place;
  const context = firstSentence(description, 64);
  return context || rawTitle;
}
