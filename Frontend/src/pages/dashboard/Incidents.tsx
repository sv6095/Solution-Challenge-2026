import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle, ChevronRight, Clock, IndianRupee, MapPin,
  Plane, Ship, Truck, Check, X, Edit, Send, Info,
  Shield, Zap, ExternalLink, CheckCircle, Loader2, FileText,
  Navigation, Search, Filter, ArrowRight, Leaf, DollarSign,
  Activity, BarChart2, MessageSquare, GitBranch, Radio, Circle,
} from "lucide-react";
import { ReasoningPanel } from "@/components/workflow/ReasoningPanel";
import { CheckpointBanner } from "@/components/workflow/CheckpointBanner";
import { GovernanceFeedbackWidget } from "@/components/workflow/GovernanceFeedbackWidget";
import { motion, AnimatePresence } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton";

const BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

import { getAccessToken, getUserId } from "@/lib/api";
import { incidentCategoryLabel, incidentCategoryColor } from "@/lib/incident-category";
import { incidentDisplayTitle } from "@/lib/incident-title";
import { fmtINR } from "@/lib/currency";

function authHeaders(): HeadersInit {
  const token = getAccessToken();
  const userId = getUserId();
  return {
    "Content-Type": "application/json",
    "X-User-Id": userId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function authFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, headers: authHeaders() });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const fetchIncidents = (status?: string) =>
  authFetch<unknown[]>(`${BASE}/incidents${status ? `?status=${status}` : ""}`);
const fetchSimulationIncidents = (status?: string) =>
  authFetch<unknown[]>(`${BASE}/intelligence/monte-carlo/incidents${status ? `?status=${status}` : ""}`);

interface AffectedNode {
  id: string; name: string; location: string; tier: number;
  risk_score: number; exposure_usd: number; safety_stock_days: number;
  stockout_days: number; mode?: string; single_source?: boolean;
  country?: string; detail?: string; lat?: number; lng?: number;
}
interface Incident {
  id: string; event_id: string; event_title: string; event_description: string;
  severity: string; status: string;
  affected_nodes: AffectedNode[]; affected_node_count: number;
  total_exposure_usd: number; min_stockout_days: number; gnn_confidence: number;
  created_at: string; source_url?: string; source?: string; source_category?: string;
  pipeline_ms?: number;
  route_options: {
    mode: string; description: string; transit_days: number;
    cost_usd: number; recommended: boolean; status_label?: string;
  }[];
  recommendation: string; recommendation_detail: string;
  backup_supplier?: { name: string; location: string; lead_time_days: number; email: string; lat?: number; lng?: number; };
  rfq_draft?: { provider: string; to: string; subject: string; body: string; editable: boolean; };
  awb_reference?: string;
  execution_timeline?: { action: string; time: string; detail: string; }[];
  approved_by?: string; approved_at?: string; resolved_at?: string;
  dismiss_reason?: string; simulation_outcome?: string; simulation_only?: boolean;
}

const approveIncident = (id: string, action: string, reason = "") =>
  authFetch<any>(`${BASE}/incidents/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ action, reason }),
  });

/* ── Design tokens ──────────────────────────────────────────────────────── */
const STATUS_META: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  AWAITING_APPROVAL: { label: "Awaiting Approval", dot: "#ef4444", bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
  ANALYZED:         { label: "Analyzed",           dot: "#3b82f6", bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
  DETECTED:         { label: "Detected",           dot: "#f59e0b", bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  APPROVED:         { label: "Approved",           dot: "#10b981", bg: "#ecfdf5", text: "#059669", border: "#a7f3d0" },
  RESOLVED:         { label: "Resolved",           dot: "#10b981", bg: "#ecfdf5", text: "#059669", border: "#a7f3d0" },
  DISMISSED:        { label: "Dismissed",          dot: "#94a3b8", bg: "#f8fafc", text: "#64748b", border: "#e2e8f0" },
};

const SEV_META: Record<string, { color: string; bg: string; border: string; ring: string }> = {
  CRITICAL: { color: "#dc2626", bg: "#fef2f2", border: "#fecaca", ring: "#ef4444" },
  HIGH:     { color: "#ea580c", bg: "#fff7ed", border: "#fed7aa", ring: "#f97316" },
  MODERATE: { color: "#ca8a04", bg: "#fefce8", border: "#fef08a", ring: "#eab308" },
  LOW:      { color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", ring: "#22c55e" },
};

const MODE_ICONS: Record<string, React.ElementType> = { air: Plane, sea: Ship, land: Truck, hybrid: Navigation };
const MODE_COLOR: Record<string, string> = { air: "#dc2626", sea: "#2563eb", land: "#16a34a", hybrid: "#7c3aed" };

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  IN: [20.59, 78.96], CN: [35.86, 104.19], US: [37.09, -95.71], DE: [51.16, 10.45],
  GB: [55.37, -3.43], JP: [36.20, 138.25], KR: [35.90, 127.86], SG: [1.35, 103.82],
  AE: [23.42, 53.84], SA: [23.88, 45.08], AU: [-25.27, 133.77], BR: [-14.23, -51.92],
  FR: [46.22, 2.21], NL: [52.13, 5.29], MX: [23.63, -102.55], VN: [14.05, 108.27],
  TH: [15.87, 100.99], MY: [4.21, 101.97], ID: [-0.79, 113.92], PH: [12.88, 121.77],
  PK: [30.37, 69.34], BD: [23.68, 90.35], TW: [23.69, 120.96], HK: [22.39, 114.11],
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Tab types ──────────────────────────────────────────────────────────── */
type Tab = "overview" | "routes" | "communication" | "timeline";

/* ── Severity pulse dot ────────────────────────────────────────────────── */
function PulseDot({ color, active }: { color: string; active: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: color }} />}
      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: color }} />
    </span>
  );
}

/* ── Incident card in left panel ─────────────────────────────────────────── */
function IncidentCard({ incident, isSelected, onClick }: { incident: any; isSelected: boolean; onClick: () => void }) {
  const sev = SEV_META[String(incident.severity)] ?? SEV_META.LOW;
  const stat = STATUS_META[String(incident.status)] ?? STATUS_META.DISMISSED;
  const isUrgent = incident.status === "AWAITING_APPROVAL";
  const displayTitle = incidentDisplayTitle(incident as Record<string, unknown>);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      onClick={onClick}
      className="cursor-pointer transition-all border-l-[3px]"
      style={{
        borderLeftColor: isSelected ? sev.ring : "transparent",
        background: isSelected ? "#f8fafc" : "transparent",
        padding: "14px 16px",
      }}
    >
      <div className="flex items-start gap-3">
        <PulseDot color={sev.ring} active={isUrgent} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-slate-900 truncate flex-1 leading-tight">
              {displayTitle}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span
              className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border"
              style={{ color: sev.color, background: sev.bg, borderColor: sev.border }}
            >
              {String(incident.severity)}
            </span>
            <span
              className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border"
              style={{ color: incidentCategoryColor(incident) ? undefined : stat.text, background: "#f8fafc", borderColor: "#e2e8f0" }}
            >
              {incidentCategoryLabel(incident)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono font-bold text-slate-400">
            <span className="text-red-500">{Number(incident.affected_node_count || 0)} nodes</span>
            <span>{fmtINR(Number(incident.total_exposure_usd || 0))}</span>
            <span>{incident.created_at ? timeAgo(String(incident.created_at)) : "—"}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const SkeletonList = () => (
  <div className="divide-y divide-slate-100">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="p-[14px] px-4 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-2.5 w-2.5 rounded-full shrink-0" />
          <Skeleton className="h-4 w-3/4 rounded" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-24 rounded" />
        </div>
        <div className="flex justify-between items-center pt-1">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-3 w-12 rounded" />
        </div>
      </div>
    ))}
  </div>
);

/* ── Main component ─────────────────────────────────────────────────────── */
const Incidents = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("id");
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [approveLoading, setApproveLoading] = useState(false);
  const [executionResult, setExecutionResult] = useState<Record<string, unknown> | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const detailPanelRef = useRef<HTMLDivElement>(null);

  const activeStatuses = ["DETECTED", "ANALYZED", "AWAITING_APPROVAL"];
  const fetchStatusParam = statusFilter === "ACTIVE" ? undefined : (statusFilter || undefined);

  const { data: incidentsRaw = [], isLoading: isIncidentsLoading } = useQuery({
    queryKey: ["incidents", statusFilter],
    queryFn: () => fetchIncidents(fetchStatusParam),
    staleTime: 15 * 60 * 1000,
  });
  const { data: simulationIncidentsRaw = [], isLoading: isSimulationLoading } = useQuery({
    queryKey: ["intelligence", "simulation-incidents", statusFilter],
    queryFn: () => fetchSimulationIncidents(fetchStatusParam),
    staleTime: 15 * 60 * 1000,
  });
  const isLoading = isIncidentsLoading || isSimulationLoading;

  const incidentsAll: Record<string, unknown>[] = useMemo(() => {
    const base = Array.isArray(incidentsRaw) ? incidentsRaw as Record<string, unknown>[] : [];
    const sim = Array.isArray(simulationIncidentsRaw) ? simulationIncidentsRaw as Record<string, unknown>[] : [];
    const mergedByKey = new Map<string, Record<string, unknown>>();
    const quality = (inc: Record<string, unknown>) => ({
      count: Number(inc.affected_node_count || 0),
      nodes: Array.isArray(inc.affected_nodes) ? inc.affected_nodes.length : 0,
      severity: (() => {
        const sev = String(inc.severity || "").toUpperCase();
        return sev === "CRITICAL" ? 4 : sev === "HIGH" ? 3 : sev === "MODERATE" ? 2 : sev === "LOW" ? 1 : 0;
      })(),
    });
    for (const inc of [...base, ...sim]) {
      const id = String(inc.id || inc.incident_id || "").trim();
      const fallback = `${String(inc.event_title || inc.title || "").trim().toLowerCase()}|${String(inc.created_at || "").trim()}`;
      const key = id || fallback;
      if (!key) continue;
      const existing = mergedByKey.get(key);
      if (!existing) {
        mergedByKey.set(key, inc);
        continue;
      }
      const a = quality(existing);
      const b = quality(inc);
      if (b.count > a.count || (b.count === a.count && b.nodes > a.nodes) || (b.count === a.count && b.nodes === a.nodes && b.severity > a.severity)) {
        mergedByKey.set(key, inc);
      }
    }
    const merged = Array.from(mergedByKey.values());
    merged.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return merged;
  }, [incidentsRaw, simulationIncidentsRaw]);
  const incidents = (statusFilter === "ACTIVE"
    ? incidentsAll.filter((inc) => activeStatuses.includes(String(inc.status || "")))
    : incidentsAll
  ).filter((inc) =>
    !search || `${String(inc.event_title || "")} ${String(inc.event_description || "")}`.toLowerCase().includes(search.toLowerCase())
  );

  const { data: detail, refetch: refetchDetail } = useQuery<Incident>({
    queryKey: ["incident", selectedId],
    queryFn: () => authFetch<Incident>(`${BASE}/incidents/${selectedId}`),
    enabled: !!selectedId,
  });

  const action = useMutation({
    mutationFn: async (vars: { id: string; action: string; reason?: string }) => {
      if (vars.action === "approve") setApproveLoading(true);
      return await approveIncident(vars.id, vars.action, vars.reason);
    },
    onSuccess: (data) => {
      if (data?.execution_timeline) setExecutionResult(data);
      setApproveLoading(false);
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident", selectedId] });
      qc.invalidateQueries({ queryKey: ["command"] });
      setTimeout(() => refetchDetail(), 500);
    },
    onError: (err: any) => {
      setApproveLoading(false);
      alert(`Action Failed: ${err.message || "Unknown error"}`);
    },
  });

  useEffect(() => { setExecutionResult(null); setActiveTab("overview"); }, [selectedId]);
  useEffect(() => {
    if (!selectedId && incidents.length > 0) setSearchParams({ id: String(incidents[0].id) });
  }, [incidents, selectedId, setSearchParams]);

  // Scroll to top of detail when incident changes
  useEffect(() => { detailPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [selectedId]);

  const canAct = detail?.status === "AWAITING_APPROVAL" &&
    String(detail?.simulation_outcome || "").toLowerCase() !== "no_impact" &&
    !(detail?.simulation_only && Number(detail?.affected_node_count || 0) === 0);

  /* ── Derive route coords from incident data ─────────────────────────── */
  const nodes = detail?.affected_nodes || [];
  const originNode = nodes.find(n => n.lat != null && n.lng != null && (n.lat !== 0 || n.lng !== 0)) || nodes[0];
  let originLat = originNode?.lat ?? 0, originLng = originNode?.lng ?? 0;
  const originLabel = originNode?.name || originNode?.country || "Origin";
  if (!originLat && !originLng && originNode?.country) {
    const cc = COUNTRY_CENTROIDS[String(originNode.country).toUpperCase().slice(0, 2)];
    if (cc) { originLat = cc[0]; originLng = cc[1]; }
  }
  let destLat = 0, destLng = 0, destLabel = "Destination";
  if (detail?.backup_supplier) {
    destLabel = detail.backup_supplier.name || detail.backup_supplier.location || "Backup Supplier";
    if ((detail.backup_supplier as any).lat != null) {
      destLat = Number((detail.backup_supplier as any).lat);
      destLng = Number((detail.backup_supplier as any).lng);
    }
    if (!destLat && !destLng) {
      const loc = String(detail.backup_supplier.location || "").trim().toUpperCase().slice(0, 2);
      const cc = COUNTRY_CENTROIDS[loc];
      if (cc) { destLat = cc[0]; destLng = cc[1]; }
    }
  } else {
    const sorted = [...nodes].filter(n => n.lat != null && n.lng != null).sort((a, b) => Number(b.exposure_usd || 0) - Number(a.exposure_usd || 0));
    const destNode = sorted.find(n => n.id !== originNode?.id) || sorted[1] || null;
    if (destNode) { destLat = destNode.lat ?? 0; destLng = destNode.lng ?? 0; destLabel = destNode.name || destNode.country || "Destination"; }
  }
  if (!destLat && !destLng) {
    const cc = COUNTRY_CENTROIDS["SG"]!;
    destLat = cc[0]; destLng = cc[1]; destLabel = "SG Hub";
  }
  let dist = haversineKm(originLat, originLng, destLat, destLng);
  if (dist < 1) {
    const alt = COUNTRY_CENTROIDS["SG"]!;
    destLat = alt[0]; destLng = alt[1]; destLabel = "SG Hub";
    dist = haversineKm(originLat, originLng, destLat, destLng);
  }

  function openRouteViewer(mode: string, days: number, cost: number) {
    const p = new URLSearchParams({
      mode, fromLat: String(originLat), fromLng: String(originLng), fromLabel: originLabel,
      toLat: String(destLat), toLng: String(destLng), toLabel: destLabel,
      cost: String(Math.round(cost)), days: String(days.toFixed(1)),
      incident: String(detail?.event_title || ""),
    });
    navigate(`/dashboard/route-viewer?${p.toString()}`);
  }

  /* ── Compute real route costs from distance ─────────────────────────────── */
  const AIR_RATE = dist < 3000 ? 4.20 : 2.90;  // $/kg
  const SEA_RATE = dist < 8000 ? 0.20 : 0.14;   // $/TEU-km
  const airCost  = dist * AIR_RATE * 5 + 600;   // 5 kg weight × rate
  const seaCost  = dist * SEA_RATE + 800;
  const landCost = dist > 6000 ? 0 : dist * 2.10 + 300;
  const airDays  = dist / 900 / 24 + 0.5;
  const seaDays  = dist * 1.25 / (35 * 1.852) / 24 + 2;
  const landDays = dist > 6000 ? 0 : dist / 80 / 24 + 0.25;
  const seaDist  = dist * 1.25;

  /* ── Status bar color ───────────────────────────────────────────────────── */
  const statusMeta = STATUS_META[String(detail?.status || "")] ?? STATUS_META.DISMISSED;
  const sevMeta    = SEV_META[String(detail?.severity || "")] ?? SEV_META.LOW;

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview",       label: "Overview",       icon: Activity },
    { id: "routes",         label: "Routes",         icon: Navigation },
    { id: "communication",  label: "Communication",  icon: MessageSquare },
    { id: "timeline",       label: "Timeline",       icon: GitBranch },
  ];

  /* ─── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="h-[calc(100vh-120px)] flex gap-0 min-h-0" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ═══════════════════ LEFT PANEL ════════════════════════════════════ */}
      <div className="w-[340px] shrink-0 border border-slate-200 bg-white flex flex-col min-h-0 shadow-sm">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 shrink-0 bg-white">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5">
              <Radio size={13} className="text-red-500" />
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">
                Crisis Center
              </span>
            </div>
            <span className="ml-auto text-[10px] font-mono font-bold bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded">
              {incidents.length} active
            </span>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search incidents…"
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 font-medium text-slate-700"
            />
          </div>

          {/* Status filters */}
          <div className="flex flex-wrap gap-1.5">
            {["ACTIVE", "", "AWAITING_APPROVAL", "ANALYZED", "APPROVED", "RESOLVED", "DISMISSED"].map((s) => (
              <button
                key={s || "all"}
                onClick={() => setStatusFilter(s)}
                className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-1 rounded transition-all"
                style={{
                  background: statusFilter === s ? "#fef2f2" : "#f8fafc",
                  color: statusFilter === s ? "#dc2626" : "#94a3b8",
                  border: `1px solid ${statusFilter === s ? "#fecaca" : "#e2e8f0"}`,
                }}
              >
                {s || "ALL"}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {isLoading ? (
            <SkeletonList />
          ) : incidents.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-xs font-mono font-medium">
              <AlertTriangle size={24} className="mx-auto mb-3 opacity-30" />
              No incidents found.
            </div>
          ) : null}
          <AnimatePresence>
            {!isLoading && incidents.map((incident: any) => (
              <IncidentCard
                key={String(incident.id)}
                incident={incident}
                isSelected={String(incident.id) === selectedId}
                onClick={() => setSearchParams({ id: String(incident.id) })}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* ═══════════════════ RIGHT PANEL ═══════════════════════════════════ */}
      <div className="flex-1 border border-l-0 border-slate-200 bg-white flex flex-col min-h-0">
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <Radio size={36} className="opacity-20" />
            <p className="font-mono text-sm font-bold">Select an incident to begin.</p>
          </div>
        ) : !detail ? (
          <div className="flex-1 flex items-center justify-center gap-3 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
            <span className="font-mono text-sm font-bold">Loading…</span>
          </div>
        ) : (
          <div className="flex flex-col h-full min-h-0">

            {/* ── Sticky header + action bar ─────────────────────────────── */}
            <div className="shrink-0 border-b border-slate-200" style={{ background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.06)" }}>
              {/* Title row */}
              <div className="px-6 pt-5 pb-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {/* Severity badge */}
                  <span className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-md border"
                    style={{ color: sevMeta.color, background: sevMeta.bg, borderColor: sevMeta.border }}>
                    {String(detail.severity)}
                  </span>
                  {/* Status badge with pulse */}
                  <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-md border"
                    style={{ color: statusMeta.text, background: statusMeta.bg, borderColor: statusMeta.border }}>
                    <PulseDot color={statusMeta.dot} active={detail.status === "AWAITING_APPROVAL"} />
                    {statusMeta.label}
                  </span>
                  {/* Category */}
                  <span className={`text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded-md border ${incidentCategoryColor(detail as unknown as Record<string, unknown>)}`}>
                    {incidentCategoryLabel(detail as unknown as Record<string, unknown>)}
                  </span>
                  {detail.pipeline_ms && Number(detail.pipeline_ms) > 0 && (
                    <span className="ml-auto text-[10px] font-mono font-bold text-slate-400 flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded border border-slate-200">
                      <Zap size={10} className="text-amber-500" />
                      Pipeline {Number(detail.pipeline_ms).toFixed(0)}ms
                    </span>
                  )}
                </div>
                <h2 className="font-headline text-xl font-bold text-slate-900 leading-tight mb-1">
                  {incidentDisplayTitle(detail as unknown as Record<string, unknown>)}
                </h2>
                <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400">
                  <span>Detected {detail.created_at ? timeAgo(String(detail.created_at)) : "—"}</span>
                  {detail.source_url && (
                    <a href={String(detail.source_url).startsWith("http") ? String(detail.source_url) : `https://${detail.source_url}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-red-500 hover:underline font-bold">
                      <ExternalLink size={10} /> Source
                    </a>
                  )}
                </div>
              </div>

              {/* KPI strip */}
              <div className="grid grid-cols-2 gap-0 border-t border-slate-100">
                {[
                  { label: "Exposure", value: fmtINR(Number(detail.total_exposure_usd || 0)), icon: IndianRupee, color: "#dc2626", critical: true },
                  { label: "Stockout", value: `${Number(detail.min_stockout_days || 0).toFixed(1)}d`, icon: Clock, color: Number(detail.min_stockout_days || 999) <= 5 ? "#dc2626" : "#d97706", critical: Number(detail.min_stockout_days || 999) <= 5 },
                ].map((m) => (
                  <div key={m.label} className="px-5 py-3 border-l border-slate-100 first:border-l-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <m.icon size={10} className="text-slate-400" />
                      <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-slate-400">{m.label}</span>
                    </div>
                    <div className="text-lg font-bold" style={{ color: m.color }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Action bar */}
              {canAct && (
                <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center gap-3">
                  <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mr-2">Action Required</span>
                  <button
                    onClick={() => action.mutate({ id: String(detail.id), action: "approve" })}
                    disabled={action.isPending || approveLoading}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white uppercase tracking-widest transition-all disabled:opacity-50 shadow-sm"
                    style={{ background: "#16a34a" }}
                  >
                    {approveLoading ? <><Loader2 size={12} className="animate-spin" /> Executing…</> : <><Check size={12} /> Approve & Execute</>}
                  </button>
                  <button
                    onClick={() => action.mutate({ id: String(detail.id), action: "override", reason: "Manual override" })}
                    disabled={action.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-slate-700 uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
                  >
                    <Edit size={12} /> Override
                  </button>
                  <button
                    onClick={() => setShowDismissDialog(true)}
                    disabled={action.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-slate-400 uppercase tracking-widest border border-slate-200 bg-white hover:bg-slate-50 transition-colors ml-auto"
                  >
                    <X size={12} /> Dismiss
                  </button>
                </div>
              )}

              {/* Tab navigation */}
              <div className="flex border-t border-slate-200 px-6 bg-white">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className="flex items-center gap-1.5 px-3 py-3 text-xs font-bold uppercase tracking-widest transition-all border-b-2 mr-1"
                      style={{
                        borderBottomColor: active ? "#dc2626" : "transparent",
                        color: active ? "#dc2626" : "#94a3b8",
                      }}
                    >
                      <Icon size={12} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Tab content ─────────────────────────────────────────────── */}
            <div ref={detailPanelRef} className="flex-1 overflow-y-auto custom-scrollbar">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="p-6 space-y-5"
                >

                  {/* ══ OVERVIEW TAB ══════════════════════════════════════ */}
                  {activeTab === "overview" && (
                    <>
                      {/* Description */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400 mb-2">Event Description</p>
                        <p className="text-sm text-slate-700 leading-relaxed font-medium">
                          {String(detail.event_description || "No description available.")}
                        </p>
                      </div>

                      {/* Recommendation */}
                      <div className="border rounded-xl overflow-hidden" style={{ borderColor: sevMeta.border }}>
                        <div className="px-5 py-3 flex items-center gap-2" style={{ background: sevMeta.bg }}>
                          <Zap size={13} style={{ color: sevMeta.color }} />
                          <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: sevMeta.color }}>
                            AI Recommendation
                          </span>
                        </div>
                        <div className="px-5 py-4 bg-white">
                          <p className="text-sm font-bold text-slate-800 mb-2">★ {String(detail.recommendation || "Review required")}</p>
                          <p className="text-sm text-slate-600 leading-relaxed">{String(detail.recommendation_detail || "")}</p>
                        </div>
                      </div>

                      {/* Backup supplier */}
                      {detail.backup_supplier && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Shield size={13} className="text-emerald-600" />
                            <span className="text-[10px] font-mono font-bold text-emerald-600 uppercase tracking-widest">Backup Supplier Identified</span>
                          </div>
                          <div className="text-sm font-bold text-slate-900">
                            {String(detail.backup_supplier.name || "")}
                            <span className="text-emerald-600 font-mono text-xs ml-3 border-l border-emerald-200 pl-3">
                              {String(detail.backup_supplier.location || "")}
                            </span>
                          </div>
                          {detail.backup_supplier.lead_time_days && (
                            <div className="text-xs text-slate-500 mt-1 font-mono">
                              Lead time: {detail.backup_supplier.lead_time_days} days
                            </div>
                          )}
                        </div>
                      )}

                      {/* Affected nodes */}
                      <div>
                        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400 mb-3">
                          Affected Nodes · {nodes.length} Praecantator-Scored
                        </p>
                        <div className="space-y-2">
                          {nodes.map((node, i) => {
                            const score = Number(node.risk_score || 0);
                            const nodeColor = score >= 0.8 ? "#dc2626" : score >= 0.6 ? "#ea580c" : "#16a34a";
                            return (
                              <div key={`${node.id}-${i}`} className="flex items-center gap-4 py-3 px-4 bg-white border border-slate-200 shadow-sm rounded-xl">
                                <div className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ backgroundColor: nodeColor, boxShadow: `0 0 6px ${nodeColor}` }} />
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm text-slate-900 font-bold tracking-wide truncate block">
                                    {String(node.name || "Node")}
                                    {Boolean(node.single_source) && (
                                      <span className="text-[9px] ml-2 text-red-600 font-mono font-bold bg-red-50 border border-red-100 px-1.5 py-0.5 rounded uppercase tracking-wider">Sole Source</span>
                                    )}
                                  </span>
                                  <span className="text-[10px] font-mono font-bold text-slate-400 mt-0.5 block">
                                    Tier {Number(node.tier || 1)} · {String(node.country || "—")}
                                  </span>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-sm font-bold" style={{ color: nodeColor }}>{(score * 100).toFixed(0)}%</div>
                                  <div className="text-[10px] font-mono text-slate-400">{fmtINR(Number(node.exposure_usd || 0))}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <CheckpointBanner incidentId={String(detail.id)} />
                      <ReasoningPanel workflowId={String(detail.id)} />
                      <GovernanceFeedbackWidget incidentId={String(detail.id)} status={String(detail.status)} />

                      {/* Status banners */}
                      {detail.status === "RESOLVED" && !executionResult && !(detail.execution_timeline?.length) && (
                        <div className="bg-emerald-50 border border-emerald-200 px-5 py-4 rounded-xl flex items-center gap-2">
                          <CheckCircle size={15} className="text-emerald-500" />
                          <p className="text-emerald-700 text-sm font-semibold">
                            Resolved by {String(detail.approved_by || "system")} at {detail.resolved_at ? new Date(String(detail.resolved_at)).toLocaleString() : "—"}
                          </p>
                        </div>
                      )}
                      {detail.status === "APPROVED" && (
                        <div className="bg-green-50 border border-green-200 px-5 py-4 rounded-xl flex items-center gap-2">
                          <Check size={15} className="text-green-600" />
                          <p className="text-green-700 text-sm font-semibold">
                            Approved by {String(detail.approved_by || "user")} at {detail.approved_at ? new Date(String(detail.approved_at)).toLocaleString() : "—"}
                          </p>
                        </div>
                      )}
                      {detail.status === "DISMISSED" && (
                        <div className="bg-slate-50 border border-slate-200 px-5 py-4 rounded-xl">
                          <p className="text-slate-500 text-sm font-semibold text-center">
                            Dismissed: {String(detail.dismiss_reason || "No reason given")}
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* ══ ROUTES TAB ════════════════════════════════════════ */}
                  {activeTab === "routes" && (
                    <>
                      {/* Route origin/dest strip */}
                      {dist > 0 && (
                        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
                          <MapPin size={12} className="text-red-400 shrink-0" />
                          <span className="text-sm font-bold text-slate-700 truncate">{originLabel}</span>
                          <ArrowRight size={14} className="text-slate-300 shrink-0" />
                          <span className="text-sm font-bold text-slate-700 truncate">{destLabel}</span>
                          <span className="ml-auto shrink-0 text-xs font-mono font-bold text-slate-400">{Math.round(dist).toLocaleString()} km</span>
                        </div>
                      )}

                      {/* Route cards */}
                      <div className="space-y-3">
                        {(detail.route_options || []).map((route, i) => {
                          const mode = String(route.mode) as keyof typeof MODE_ICONS;
                          const ModeIcon = MODE_ICONS[mode] || Truck;
                          const modeColor = MODE_COLOR[mode] || "#64748b";
                          const isRec = Boolean(route.recommended);
                          const isViable = mode !== "land" || dist <= 6000;

                          let routeDist = 0, routeDays = 0, routeCost = 0;
                          if (mode === "air")  { routeDist = dist; routeDays = airDays; routeCost = airCost; }
                          if (mode === "sea")  { routeDist = seaDist; routeDays = seaDays; routeCost = seaCost; }
                          if (mode === "land") { routeDist = dist; routeDays = landDays; routeCost = landCost; }
                          if (mode === "hybrid") { routeDist = dist; routeDays = (seaDays + landDays) / 2; routeCost = seaCost * 0.7 + landCost * 0.3; }
                          if (Number(route.transit_days) > 0) routeDays = Number(route.transit_days);
                          if (Number(route.cost_usd) > 0) routeCost = Number(route.cost_usd);

                          const finalDesc = isViable
                            ? String(route.description || "").replace(/0km direct/gi, `${Math.round(routeDist).toLocaleString()} km direct`).replace(/\b0\s*km\b/gi, `${Math.round(routeDist).toLocaleString()} km`)
                            : "Not viable — no road corridor between these coordinates";

                          // CO2 estimates
                          const co2 = { air: 0.602, sea: 0.012, land: 0.096, hybrid: 0.045 }[mode] ?? 0.1;
                          const co2Kg = Math.round(routeDist * 5 * co2);

                          if (!isViable) return null;

                          return (
                            <motion.div
                              key={`${mode}-${i}`}
                              whileHover={isViable ? { scale: 1.01, boxShadow: "0 4px 20px rgba(0,0,0,.10)" } : {}}
                              whileTap={isViable ? { scale: 0.99 } : {}}
                              onClick={isViable ? () => openRouteViewer(mode, routeDays, routeCost) : undefined}
                              className="rounded-xl border overflow-hidden transition-all"
                              style={{
                                borderColor: isRec ? modeColor : "#e2e8f0",
                                opacity: isViable ? 1 : 0.5,
                                cursor: isViable ? "pointer" : "default",
                              }}
                            >
                              {/* Card header */}
                              <div className="flex items-center gap-3 px-4 py-3" style={{ background: isRec ? `${modeColor}12` : "#f8fafc" }}>
                                <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: modeColor + "20" }}>
                                  <ModeIcon size={16} style={{ color: modeColor }} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-slate-800 capitalize">{mode === "hybrid" ? "Hybrid (Sea + Land)" : mode} Freight</span>
                                    {isRec && (
                                      <span className="text-[9px] font-mono font-bold uppercase px-2 py-0.5 rounded" style={{ color: modeColor, background: modeColor + "18", border: `1px solid ${modeColor}40` }}>
                                        ★ Recommended
                                      </span>
                                    )}
                                    {!isViable && <span className="text-[9px] font-mono text-slate-400 uppercase">N/A</span>}
                                  </div>
                                  <p className="text-xs text-slate-500 truncate mt-0.5">{isViable ? finalDesc : "Route not viable"}</p>
                                </div>
                                {isViable && (
                                  <ChevronRight size={16} className="text-slate-400 shrink-0" />
                                )}
                              </div>

                              {/* Card metrics */}
                              {isViable && (
                                <div className="grid grid-cols-4 divide-x divide-slate-100 bg-white">
                                  {[
                                    { label: "Distance", value: `${Math.round(routeDist).toLocaleString()} km`, icon: <MapPin size={10} /> },
                                    { label: "Transit", value: routeDays > 0 ? `${routeDays.toFixed(1)}d` : "—", icon: <Clock size={10} /> },
                                    { label: "Cost", value: routeCost > 0 ? fmtINR(routeCost) : "—", icon: <IndianRupee size={10} /> },
                                    { label: "CO₂", value: co2Kg > 0 ? `${co2Kg.toLocaleString()} kg` : "—", icon: <Leaf size={10} /> },
                                  ].map((m) => (
                                    <div key={m.label} className="px-3 py-2.5 text-center">
                                      <div className="flex items-center justify-center gap-1 text-slate-400 mb-1">{m.icon}<span className="text-[8px] font-mono uppercase font-bold tracking-wider">{m.label}</span></div>
                                      <div className="text-xs font-bold text-slate-800">{m.value}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>

                      {/* Hybrid explainer */}
                      {detail.route_options?.some(r => r.mode === "hybrid" || r.recommended) && (
                        <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
                          <p className="text-[10px] font-mono font-bold text-violet-600 uppercase tracking-widest mb-1">About Hybrid Routes</p>
                          <p className="text-xs text-violet-700 leading-relaxed">
                            Hybrid routes combine sea freight (~70% of distance) for cost savings with land/rail for the final leg, balancing transit time and cost where road-only corridors are not viable.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  {/* ══ COMMUNICATION TAB ═════════════════════════════════ */}
                  {activeTab === "communication" && (
                    <>
                      {detail.rfq_draft ? (
                        <div className="border border-slate-200 bg-white rounded-xl overflow-hidden">
                          <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                            <Send size={12} className="text-blue-500" />
                            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">AI-Drafted RFQ</span>
                          </div>
                          <div className="px-5 py-5 space-y-4">
                            <div className="grid grid-cols-[80px_1fr] gap-y-2 text-sm">
                              <span className="text-slate-400 font-mono font-bold pt-0.5">To:</span>
                              <span className="text-slate-900 font-bold">{String(detail.rfq_draft.to || "—")}</span>
                              <span className="text-slate-400 font-mono font-bold pt-0.5">Subject:</span>
                              <span className="text-slate-900 font-bold">{String(detail.rfq_draft.subject || "—")}</span>
                            </div>
                            <pre className="text-xs text-slate-700 bg-slate-50 border border-slate-200 p-4 rounded-xl whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar">
                              {String(detail.rfq_draft.body || "")}
                            </pre>
                            <div className="flex justify-end gap-3">
                              <button className="px-4 py-2 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 font-mono text-xs uppercase tracking-widest rounded-lg shadow-sm font-bold transition-colors">
                                Edit Draft
                              </button>
                              <button className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 font-mono text-xs uppercase tracking-widest rounded-lg shadow-sm font-bold transition-colors">
                                <Send size={12} className="inline mr-1.5" />Send RFQ
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-12 text-slate-400">
                          <MessageSquare size={28} className="mx-auto mb-3 opacity-30" />
                          <p className="text-sm font-mono font-bold">No draft communication available.</p>
                          <p className="text-xs mt-1">RFQ is auto-generated for CRITICAL and HIGH severity incidents.</p>
                        </div>
                      )}
                    </>
                  )}

                  {/* ══ TIMELINE TAB ══════════════════════════════════════ */}
                  {activeTab === "timeline" && (
                    <>
                      {(((executionResult?.execution_timeline || detail.execution_timeline || []) as any[]).length > 0) ? (
                        <div className="border border-emerald-200 bg-emerald-50 rounded-xl overflow-hidden">
                          <div className="px-5 py-3 flex items-center gap-2 border-b border-emerald-100">
                            <CheckCircle size={14} className="text-emerald-600" />
                            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-600">Execution Timeline</span>
                            {(executionResult?.awb_reference || detail.awb_reference) && (
                              <span className="ml-auto text-[10px] font-mono font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded">
                                {String(executionResult?.awb_reference || detail.awb_reference)}
                              </span>
                            )}
                          </div>
                          <div className="px-5 py-5 space-y-0">
                            {(((executionResult?.execution_timeline || detail.execution_timeline || []) as any[])).map((step: any, i: number, arr: any[]) => (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.12 }}
                                className="flex items-start gap-3 py-3"
                              >
                                <div className="flex flex-col items-center mt-0.5">
                                  <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                                  {i < arr.length - 1 && <div className="w-px flex-1 min-h-[20px] bg-emerald-200 mt-1" />}
                                </div>
                                <div className="flex-1 min-w-0 pb-2">
                                  <div className="flex items-center gap-3">
                                    <span className="text-sm font-bold text-slate-800">{String(step.action || "")}</span>
                                    <span className="text-[10px] font-mono text-emerald-600 font-bold">{String(step.time || "")}</span>
                                  </div>
                                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{String(step.detail || "")}</p>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-12 text-slate-400">
                          <GitBranch size={28} className="mx-auto mb-3 opacity-30" />
                          <p className="text-sm font-mono font-bold">No execution timeline yet.</p>
                          <p className="text-xs mt-1">Timeline appears after the incident is approved and executed.</p>
                        </div>
                      )}
                    </>
                  )}

                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* ── Dismiss dialog ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showDismissDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowDismissDialog(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-sm mx-4"
            >
              <h3 className="font-bold text-slate-900 text-lg mb-1">Dismiss Incident</h3>
              <p className="text-sm text-slate-500 mb-4">Please provide a reason for dismissal. This will be logged for audit.</p>
              <textarea
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="Reason for dismissal…"
                rows={3}
                className="w-full border border-slate-200 rounded-lg p-3 text-sm text-slate-700 resize-none focus:outline-none focus:border-slate-400"
              />
              <div className="flex gap-3 mt-4">
                <button onClick={() => setShowDismissDialog(false)} className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-600 font-bold text-sm rounded-xl hover:bg-slate-50">Cancel</button>
                <button
                  onClick={() => {
                    if (dismissReason.trim()) {
                      action.mutate({ id: String(detail?.id), action: "dismiss", reason: dismissReason.trim() });
                      setShowDismissDialog(false);
                      setDismissReason("");
                    }
                  }}
                  disabled={!dismissReason.trim()}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white font-bold text-sm rounded-xl hover:bg-red-700 disabled:opacity-40"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Incidents;
