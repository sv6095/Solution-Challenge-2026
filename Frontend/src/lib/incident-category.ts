/** Align incident labels with Intelligence signal categories. */
const CATEGORY_LABELS: Record<string, string> = {
  disaster: "Disaster",
  geopolitical: "Geopolitical",
  news: "News",
  regulatory: "Regulatory",
  sentiment: "Sentiment",
  humanitarian: "Humanitarian",
  social_news: "Social",
  maritime: "Maritime",
  trade: "Trade",
};

const CATEGORY_COLORS: Record<string, string> = {
  disaster: "bg-red-50 text-red-700 border-red-200",
  geopolitical: "bg-purple-50 text-purple-700 border-purple-200",
  news: "bg-blue-50 text-blue-700 border-blue-200",
  regulatory: "bg-slate-100 text-slate-700 border-slate-200",
  sentiment: "bg-pink-50 text-pink-700 border-pink-200",
  humanitarian: "bg-amber-50 text-amber-800 border-amber-200",
  social_news: "bg-indigo-50 text-indigo-700 border-indigo-200",
  maritime: "bg-cyan-50 text-cyan-700 border-cyan-200",
  trade: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function inferCategoryFromSource(source: string): string {
  if (!source) return "";
  if (["nasa_eonet", "gdacs", "usgs", "nasa_firms", "reliefweb"].some((s) => source.includes(s))) return "disaster";
  if (["acled", "gdelt", "ofac", "cii_model"].some((s) => source.includes(s))) return "geopolitical";
  if (["newsapi", "gnews", "gdelt"].some((s) => source.includes(s))) return "news";
  if (source.includes("sentiment")) return "sentiment";
  if (["portwatch", "imf_portwatch", "wto"].some((s) => source.includes(s))) return "maritime";
  if (source.includes("mastodon") || source.includes("social")) return "social_news";
  return "";
}

export function incidentCategoryKey(inc: Record<string, unknown>): string {
  const explicit = String(inc.source_category || inc.category || "").trim().toLowerCase();
  if (explicit) return explicit;
  return inferCategoryFromSource(String(inc.source || "").trim().toLowerCase());
}

export function incidentCategoryLabel(inc: Record<string, unknown>): string {
  const key = incidentCategoryKey(inc);
  if (key && CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  const eventType = String(inc.event_type || "").replace(/[-_]/g, " ").trim();
  if (eventType && eventType.toLowerCase() !== "risk" && eventType.toLowerCase() !== "disruption") {
    return eventType.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return "Supply Risk";
}

export function incidentCategoryColor(inc: Record<string, unknown>): string {
  const key = incidentCategoryKey(inc);
  return CATEGORY_COLORS[key] || "bg-slate-100 text-slate-600 border-slate-200";
}
