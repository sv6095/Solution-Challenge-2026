import { useRef, useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Plane, Ship, Truck, Clock, MapPin, Navigation,
  Leaf, DollarSign, IndianRupee, AlertTriangle, CheckCircle, Loader2, RefreshCw,
} from "lucide-react";
import { fmtINR } from "@/lib/currency";
import { Map, MapRoute, MapControls, MapMarker, MarkerContent, MarkerTooltip, type MapRef } from "@/components/ui/map";
import { getAccessToken, getUserId } from "@/lib/api";

const BASE = (import.meta.env.VITE_API_URL ?? "/api").replace(/\/+$/, "");

function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return {
    "Content-Type": "application/json",
    "X-User-Id": getUserId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/* ── Types ────────────────────────────────────────────────────────────────── */
interface RouteCoords { coordinates: [number, number][]; distance_km: number; viable?: boolean; reason?: string; source?: string; source_label?: string; }
interface AirRouteData {
  direct: RouteCoords;
  via_hubs: RouteCoords & { origin_hub?: HubAirport; dest_hub?: HubAirport };
  via_alt_hub?: RouteCoords & { hub?: HubAirport };
  source_label?: string;
  airport_source?: string;
  airport_count?: number;
}
interface HubAirport { iata: string; name: string; city: string; country?: string; lat: number; lng: number; }
interface CostData {
  total_usd: number; transit_days: number; co2_kg: number;
  breakdown: Record<string, number>;
  mode: string; distance_km: number;
}



const MODE_META = {
  air:    { label: "Air Freight",    icon: Plane,  color: "#dc2626", bg: "#fef2f2", border: "#fecaca", speed: "Fastest",    co2: "High"   },
  sea:    { label: "Sea Freight",    icon: Ship,   color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", speed: "Slowest",    co2: "Lowest" },
  land:   { label: "Land / Road",   icon: Truck,  color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", speed: "Moderate",   co2: "Medium" },
};

/* ── Haversine ─────────────────────────────────────────────────────────────── */
function hav(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ── Cost Badge ─────────────────────────────────────────────────────────────── */
function CostBreakdown({ cost }: { cost: CostData }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <IndianRupee size={16} className="text-emerald-600" />
          <span className="font-bold text-slate-800">Freight Cost Estimate</span>
          <span className="text-xs font-mono text-slate-400">(approx. 5t cargo)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-emerald-600">{fmtINR(cost.total_usd)}</span>
          <span className="text-xs text-slate-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-3 bg-slate-50">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(cost.breakdown).map(([k, v]) => (
              <div key={k} className="bg-white rounded-lg border border-slate-200 px-3 py-2.5">
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400 mb-1">
                  {k.replace(/_/g, " ")}
                </div>
                <div className="font-bold text-slate-800 text-sm">{fmtINR(v)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 pt-2 text-xs font-mono text-slate-500">
            <span className="flex items-center gap-1"><Clock size={11} />{Number(cost.transit_days ?? 0).toFixed(1)} days</span>
            <span className="flex items-center gap-1 text-emerald-600"><Leaf size={11} />{Number(cost.co2_kg ?? 0).toLocaleString()} kg CO₂</span>
            <span className="flex items-center gap-1"><MapPin size={11} />{Number(cost.distance_km ?? 0).toLocaleString()} km</span>
          </div>
          <p className="text-[10px] text-slate-400 font-mono">Based on 2024 industry average freight rates. Actual costs vary by carrier, Incoterms, and market conditions.</p>
        </div>
      )}
    </div>
  );
}

/* ── Route tab selector ──────────────────────────────────────────────────── */
function ModeTab({ mode, active, label, Icon, color, onClick }: {
  mode: string; active: boolean; label: string; Icon: React.ElementType; color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-bold text-xs transition-all border ${
        active
          ? "text-white border-transparent shadow-md"
          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700"
      }`}
      style={active ? { backgroundColor: color, borderColor: color } : {}}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

/* ── Main component ─────────────────────────────────────────────────────── */
export default function RouteViewer() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mapRef = useRef<MapRef>(null);

  const fromLat   = parseFloat(params.get("fromLat") || "");
  const fromLng   = parseFloat(params.get("fromLng") || "");
  const fromLabel = params.get("fromLabel") || "Origin";
  const toLat     = parseFloat(params.get("toLat") || "");
  const toLng     = parseFloat(params.get("toLng") || "");
  const toLabel   = params.get("toLabel") || "Destination";
  const incTitle  = params.get("incident") || "Route Visualisation";
  const paramMode = (params.get("mode") || "air") as keyof typeof MODE_META;

  const hasCoords = !isNaN(fromLat) && !isNaN(fromLng) && !isNaN(toLat) && !isNaN(toLng);

  const [activeMode, setActiveMode] = useState<keyof typeof MODE_META>(
    Object.keys(MODE_META).includes(paramMode) ? paramMode : "air"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);



  // Route data per mode
  const [seaCoords,    setSeaCoords]    = useState<[number,number][] | null>(null);
  const [seaDist,      setSeaDist]      = useState(0);
  const [landCoords,   setLandCoords]   = useState<[number,number][] | null>(null);
  const [landDist,     setLandDist]     = useState(0);
  const [landDuration, setLandDuration] = useState(0);
  const [landViable,   setLandViable]   = useState<boolean | null>(null);
  const [landReason,   setLandReason]   = useState("");
  const [airData,      setAirData]      = useState<AirRouteData | null>(null);
  const [activeAirRoute, setActiveAirRoute] = useState(0);

  // Source attribution per mode (which real API answered)
  const [sourceMeta, setSourceMeta] = useState<Partial<Record<string, string>>>({});

  // Cost data per mode
  const [costs, setCosts] = useState<Partial<Record<string, CostData>>>({});

  const directKm = hasCoords ? hav(fromLat, fromLng, toLat, toLng) : 0;

  // Orient map so it "faces" the destination (user). Bearing is calculated from Destination to Origin.
  // This places the Origin at the top of the screen and Destination at the bottom, coming towards the viewer.
  const routeBearing = hasCoords ? (() => {
    const r = Math.PI / 180;
    const φ1 = toLat * r;
    const φ2 = fromLat * r;
    const Δλ = (fromLng - toLng) * r;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) / r + 360) % 360;
  })() : 0;

  const center: [number, number] = hasCoords
    ? (activeMode === "land" ? [fromLng, fromLat] : [(fromLng + toLng) / 2, (fromLat + toLat) / 2])
    : [78.96, 20.59];
  const zoom = hasCoords
    ? (activeMode === "land" ? 14 : (directKm > 8000 ? 2 : directKm > 4000 ? 2.5 : directKm > 2000 ? 3.5 : directKm > 500 ? 5 : 7))
    : 4;

  /* ── Fetch cost for a mode ──────────────────────────────────────────────── */
  const fetchCost = useCallback(async (mode: string, distance_km: number, key: string) => {
    if (!distance_km || costs[key]) return;
    try {
      const res = await fetch(`${BASE}/route-cost`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mode, distance_km, weight_kg: 5000 }),
      });
      if (res.ok) {
        const data = await res.json();
        setCosts(prev => ({ ...prev, [key]: data }));
      }
    } catch { /* silent */ }
  }, [costs]);

  /* ── Fetch sea route ────────────────────────────────────────────────────── */
  const fetchSea = useCallback(async () => {
    if (!hasCoords || seaCoords) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/sea-route`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ from_lat: fromLat, from_lng: fromLng, to_lat: toLat, to_lng: toLng }),
      });
      const data = await res.json();
      setSeaCoords(data.coordinates);
      setSeaDist(data.distance_km);
      const lbl = data.source === "searoute"
        ? `Eurostat searoute v1.6 (real maritime lanes)`
        : `Maritime waypoint graph (${(data.waypoints || []).length} chokepoints)`;
      setSourceMeta(prev => ({ ...prev, sea: lbl }));
      fetchCost("sea", data.distance_km, "sea");
    } catch (e: any) {
      setError("Sea route API unavailable.");
    } finally { setLoading(false); }
  }, [hasCoords, seaCoords, fromLat, fromLng, toLat, toLng, fetchCost]);

  /* ── Fetch land route ───────────────────────────────────────────────────── */
  const fetchLand = useCallback(async () => {
    if (!hasCoords || landCoords !== null || landViable === false) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/land-route`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ from_lat: fromLat, from_lng: fromLng, to_lat: toLat, to_lng: toLng }),
      });
      const data = await res.json();
      if (data.viable === false) {
        setLandViable(false);
        setLandReason(data.reason || "Not viable by road.");
        setLandDist(data.distance_km || directKm);
      } else {
        setLandViable(true);
        setLandCoords(data.coordinates);
        setLandDist(data.distance_km);
        setLandDuration(data.duration_hours);
        setSourceMeta(prev => ({ ...prev, land: data.source_label || data.source || "OSRM" }));
        fetchCost("land", data.distance_km, "land");
      }
    } catch (e: any) {
      setError("Land route API unavailable.");
    } finally { setLoading(false); }
  }, [hasCoords, landCoords, landViable, fromLat, fromLng, toLat, toLng, directKm, fetchCost]);

  /* ── Fetch air route ────────────────────────────────────────────────────── */
  const fetchAir = useCallback(async () => {
    if (!hasCoords || airData) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/air-route`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ from_lat: fromLat, from_lng: fromLng, to_lat: toLat, to_lng: toLng, from_label: fromLabel, to_label: toLabel }),
      });
      const data: AirRouteData = await res.json();
      setAirData(data);
      // Store source attribution for display
      if (data.source_label) {
        setSourceMeta(prev => ({ ...prev, air: data.source_label }));
      }
      // Fetch costs for both routes immediately
      fetchCost("air", data.via_hubs.distance_km, "air-0");
      if (data.via_alt_hub) {
        fetchCost("air", data.via_alt_hub.distance_km, "air-1");
      }
    } catch (e: any) {
      setError("Air route API unavailable.");
    } finally { setLoading(false); }
  }, [hasCoords, airData, fromLat, fromLng, toLat, toLng, fromLabel, toLabel, fetchCost]);

  /* ── Trigger fetch when mode changes ─────────────────────────────────────── */
  useEffect(() => {
    if (activeMode === "sea")    fetchSea();
    if (activeMode === "land")   fetchLand();
    if (activeMode === "air")    fetchAir();
  }, [activeMode]); // eslint-disable-line

  /* ── Map ease-to on mode switch ──────────────────────────────────────────── */
  useEffect(() => {
    mapRef.current?.easeTo({ center, zoom, bearing: routeBearing, pitch: 45, duration: 800 });
  }, [activeMode, center, zoom, routeBearing]); // eslint-disable-line

  if (!hasCoords) {
    return (
      <div className="h-[calc(100vh-120px)] flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <AlertTriangle size={32} className="text-amber-500 mx-auto" />
          <p className="text-slate-700 font-bold">No route coordinates provided.</p>
          <button onClick={() => navigate(-1)} className="text-sm text-slate-500 underline">← Go back</button>
        </div>
      </div>
    );
  }

  const meta = MODE_META[activeMode] ?? MODE_META.air;
  const ModeIcon = meta.icon;

  /* ── Determine active route coords / distance ────────────────────────────── */
  let activeCoords: [number, number][] = [];
  let activeDist = directKm;
  let activeRoutes: { label: string; coords: [number,number][]; color: string; dash?: [number,number] }[] = [];

  if (activeMode === "sea" && seaCoords) {
    activeCoords = seaCoords;
    activeDist = seaDist;
    activeRoutes = [{ label: "Maritime Route", coords: seaCoords, color: "#2563eb" }];
  } else if (activeMode === "land") {
    if (landCoords && landViable) {
      activeCoords = landCoords;
      activeDist = landDist;
      activeRoutes = [{ label: "Road Route (OSRM)", coords: landCoords, color: "#16a34a" }];
    }
  } else if (activeMode === "air" && airData) {
    const airRouteOptions = [
      { label: `Via ${airData.via_hubs.origin_hub?.city ?? "Hub"} → ${airData.via_hubs.dest_hub?.city ?? "Hub"}`, coords: airData.via_hubs.coordinates, color: "#f59e0b", dist: airData.via_hubs.distance_km, dash: [8,4] as [number,number] },
      ...(airData.via_alt_hub ? [{ label: `Via ${airData.via_alt_hub.hub?.city ?? "Alt Hub"}`, coords: airData.via_alt_hub.coordinates!, color: "#7c3aed", dist: airData.via_alt_hub.distance_km, dash: [4,4] as [number,number] }] : []),
    ];
    activeRoutes = airRouteOptions.map(r => ({ label: r.label, coords: r.coords, color: r.color, dash: r.dash }));
    activeCoords = airRouteOptions[activeAirRoute]?.coords ?? airRouteOptions[0]?.coords ?? [];
    activeDist = airRouteOptions[activeAirRoute]?.dist ?? directKm;
  }

  const activeCostKey = activeMode === "air" ? `air-${activeAirRoute}` : activeMode;
  const activeCost = costs[activeCostKey];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", background: "#f8fafc", fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <button
          onClick={() => navigate(-1)}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, padding: "5px 11px", cursor: "pointer" }}
        >
          <ArrowLeft size={13} /> Back
        </button>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 6, flex: 1, flexWrap: "wrap" }}>
          {(Object.keys(MODE_META) as (keyof typeof MODE_META)[]).map((m) => {
            const mm = MODE_META[m];
            const Icon = mm.icon;
            const active = activeMode === m;
            return (
              <button
                key={m}
                onClick={() => setActiveMode(m)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: "pointer", transition: "all .15s", border: "1.5px solid",
                  borderColor: active ? mm.color : "#e2e8f0",
                  background: active ? mm.color : "#fff",
                  color: active ? "#fff" : "#64748b",
                }}
              >
                <Icon size={13} />
                {mm.label}
              </button>
            );
          })}
        </div>

        {/* Route summary pills */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {[
            { label: `${Math.round(activeDist).toLocaleString()} km`, icon: <MapPin size={10} />, c: "#475569" },
            ...(activeCost ? [
              { label: fmtINR(activeCost.total_usd), icon: <IndianRupee size={10} />, c: "#dc2626" },
              { label: `${Number(activeCost.transit_days ?? 0).toFixed(1)}d`, icon: <Clock size={10} />, c: "#475569" },
            ] : []),
          ].map((p, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: p.c, border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 6, padding: "4px 9px" }}>
              {p.icon}{p.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Route subtitle ─────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, background: meta.bg, borderBottom: `1px solid ${meta.border}`, padding: "8px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <ModeIcon size={14} style={{ color: meta.color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: meta.color }}>{meta.label}</span>
        <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
          {fromLabel} → {toLabel}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "monospace", color: "#94a3b8" }}>
          Speed: {meta.speed} · CO₂: {meta.co2}
        </span>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "#94a3b8" }}>{incTitle}</span>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

        {/* Map area */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {loading && (
            <div style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(248,250,252,.85)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <Loader2 size={20} className="animate-spin" style={{ color: meta.color }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b" }}>Computing {meta.label}…</span>
            </div>
          )}

          <Map
            ref={mapRef}
            theme="light"
            styles={
              activeMode === "land"
                ? {
                    light: "https://tiles.openfreemap.org/styles/liberty",
                    dark: "https://tiles.openfreemap.org/styles/liberty",
                  }
                : {
                    light: "https://tiles.openfreemap.org/styles/bright",
                    dark: "https://tiles.openfreemap.org/styles/bright",
                  }
            }
            center={center}
            zoom={zoom}
            pitch={45}
            bearing={routeBearing}
            className="w-full h-full"
          >
            <MapControls position="bottom-right" showZoom showCompass showFullscreen />

            {/* Render all active routes */}
            {activeRoutes.map((r, i) => [
              // Glow layer
              <MapRoute key={`glow-${activeMode}-${i}`} id={`glow-${activeMode}-${i}`}
                coordinates={r.coords} color={r.color} width={18} opacity={0.10} interactive={false} />,
              // Main line
              <MapRoute key={`line-${activeMode}-${i}`} id={`line-${activeMode}-${i}`}
                coordinates={r.coords} color={r.color} width={activeRoutes.length > 1 ? (i === activeAirRoute ? 4 : 2) : 4}
                opacity={activeRoutes.length > 1 ? (i === activeAirRoute ? 1 : 0.35) : 0.95}
                dashArray={r.dash} interactive={false} />,
            ])}

            {/* Waypoint markers (air hubs) */}
            {activeMode === "air" && airData?.via_hubs?.origin_hub && (
              <MapMarker longitude={airData.via_hubs.origin_hub.lng} latitude={airData.via_hubs.origin_hub.lat}>
                <MarkerContent>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", border: "2px solid white", boxShadow: "0 0 4px #f59e0b" }} />
                </MarkerContent>
                <MarkerTooltip>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>
                    {airData.via_hubs.origin_hub.iata} — {airData.via_hubs.origin_hub.name}
                  </span>
                </MarkerTooltip>
              </MapMarker>
            )}
            {activeMode === "air" && airData?.via_hubs?.dest_hub && (
              <MapMarker longitude={airData.via_hubs.dest_hub.lng} latitude={airData.via_hubs.dest_hub.lat}>
                <MarkerContent>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", border: "2px solid white", boxShadow: "0 0 4px #f59e0b" }} />
                </MarkerContent>
                <MarkerTooltip>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>
                    {airData.via_hubs.dest_hub.iata} — {airData.via_hubs.dest_hub.name}
                  </span>
                </MarkerTooltip>
              </MapMarker>
            )}
            {activeMode === "air" && airData?.via_alt_hub?.hub && (
              <MapMarker longitude={airData.via_alt_hub.hub.lng} latitude={airData.via_alt_hub.hub.lat}>
                <MarkerContent>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7c3aed", border: "2px solid white" }} />
                </MarkerContent>
                <MarkerTooltip>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>
                    {airData.via_alt_hub.hub.iata} — {airData.via_alt_hub.hub.name}
                  </span>
                </MarkerTooltip>
              </MapMarker>
            )}

            {/* Origin marker */}
            <MapMarker longitude={fromLng} latitude={fromLat}>
              <MarkerContent>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#16a34a", border: "2.5px solid white", boxShadow: "0 0 8px #16a34a" }} />
              </MarkerContent>
              <MarkerTooltip><span style={{ fontSize: 11, fontWeight: 700 }}>Origin: {fromLabel}</span></MarkerTooltip>
            </MapMarker>

            {/* Destination marker */}
            <MapMarker longitude={toLng} latitude={toLat}>
              <MarkerContent>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#dc2626", border: "2.5px solid white", boxShadow: "0 0 8px #dc2626" }} />
              </MarkerContent>
              <MarkerTooltip><span style={{ fontSize: 11, fontWeight: 700 }}>Destination: {toLabel}</span></MarkerTooltip>
            </MapMarker>
          </Map>

          {/* Map legend */}
          {activeRoutes.length > 1 && (
            <div style={{ position: "absolute", bottom: 52, left: 12, zIndex: 10, background: "rgba(255,255,255,.95)", backdropFilter: "blur(8px)", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
              <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#94a3b8", margin: "0 0 8px" }}>Route Options</p>
              {activeRoutes.map((r, i) => (
                <div key={i} onClick={() => setActiveAirRoute(i)} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, cursor: "pointer", opacity: i === activeAirRoute ? 1 : 0.5 }}>
                  <span style={{ display: "inline-block", width: 24, height: 3, borderRadius: 2, background: r.color }} />
                  <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: i === activeAirRoute ? 700 : 400, color: "#334155" }}>{r.label}</span>
                </div>
              ))}
            </div>
          )}


        </div>

        {/* ── Side panel ──────────────────────────────────────────────────── */}
        <div style={{ width: 320, flexShrink: 0, background: "#fff", borderLeft: "1px solid #e2e8f0", overflowY: "auto", display: "flex", flexDirection: "column", gap: 0 }}>
          {/* Header */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
            <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#94a3b8", margin: 0 }}>
              {meta.label} · Route Detail
            </p>
          </div>

          {/* Not viable banner (land) */}
          {activeMode === "land" && landViable === false && (
            <div style={{ margin: 14, padding: "14px 16px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <AlertTriangle size={14} style={{ color: "#dc2626", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color: "#dc2626", textTransform: "uppercase" }}>Not Viable by Road</span>
              </div>
              <p style={{ fontSize: 12, color: "#7f1d1d", margin: 0, lineHeight: 1.5 }}>{landReason}</p>
              <button
                onClick={() => setActiveMode("sea")}
                style={{ marginTop: 10, padding: "7px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
              >
                Switch to Sea Freight →
              </button>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div style={{ margin: 14, padding: "14px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10 }}>
              <p style={{ fontSize: 12, color: "#92400e", margin: 0 }}>{error}</p>
              <button
                onClick={() => { setError(null); if (activeMode === "sea") { setSeaCoords(null); fetchSea(); } if (activeMode === "land") { setLandCoords(null); setLandViable(null); fetchLand(); } if (activeMode === "air") { setAirData(null); fetchAir(); } }}
                style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "#92400e", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          )}

          {/* Route metrics */}
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Distance", value: `${Math.round(activeDist).toLocaleString()} km`, icon: <MapPin size={12} />, color: "#0f172a" },
              ...(activeMode === "land" && landDuration ? [{ label: "Est. Drive Time", value: `${landDuration.toFixed(0)}h`, icon: <Clock size={12} />, color: "#0f172a" }] : []),
              ...(activeCost ? [
                { label: "Freight Cost (5t)", value: fmtINR(activeCost.total_usd), icon: <IndianRupee size={12} />, color: "#16a34a" },
                { label: "Transit Days", value: `${Number(activeCost.transit_days ?? 0).toFixed(1)} days`, icon: <Clock size={12} />, color: "#0f172a" },
                { label: "CO₂ Footprint", value: `${Number(activeCost.co2_kg ?? 0).toLocaleString()} kg`, icon: <Leaf size={12} />, color: "#16a34a" },
              ] : []),
            ].map(m => (
              <div key={m.label} style={{ border: "1px solid #e2e8f0", borderRadius: 9, padding: "11px 14px", background: "#fff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, color: "#94a3b8" }}>
                  {m.icon}
                  <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em" }}>{m.label}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: m.color }}>{m.value}</div>
              </div>
            ))}

            {/* Air sub-routes selector */}
            {activeMode === "air" && airData && activeRoutes.length > 1 && (
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#94a3b8", marginBottom: 8 }}>Air Route Options</p>
                {activeRoutes.map((r, i) => {
                  const isA = i === activeAirRoute;
                  return (
                    <div
                      key={i}
                      onClick={() => setActiveAirRoute(i)}
                      style={{ border: `1.5px solid ${isA ? r.color : "#e2e8f0"}`, borderRadius: 9, padding: "10px 12px", background: isA ? "#fafcff" : "#fff", cursor: "pointer", marginBottom: 8, transition: "all .15s" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: r.color, flexShrink: 0, display: "inline-block" }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{r.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Cost breakdown */}
            {activeCost && (
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#94a3b8", marginBottom: 8 }}>Cost Breakdown</p>
                {Object.entries(activeCost.breakdown).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <span style={{ fontSize: 11, color: "#64748b", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{fmtINR(v)}</span>
                  </div>
                ))}
                <div style={{ fontSize: 9, fontFamily: "monospace", color: "#94a3b8", marginTop: 10, lineHeight: 1.4 }}>
                  Based on 2024 avg freight rates for 5,000 kg cargo. Actual costs vary by carrier and Incoterms.
                </div>
              </div>
            )}

            {/* Locations */}
            <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
              {[{ label: "Origin", name: fromLabel, dot: "#16a34a" }, { label: "Destination", name: toLabel, dot: "#dc2626" }].map(({ label, name, dot }) => (
                <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 12px", background: "#fff", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#94a3b8" }}>{label}</span>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", margin: 0 }}>{name}</p>
                </div>
              ))}
            </div>

            {/* Routing source attribution */}
            {(sourceMeta[activeMode] || (activeMode === "air" && airData?.source_label)) && (
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#94a3b8", marginBottom: 6 }}>Routing Source</p>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8 }}>
                  <CheckCircle size={12} style={{ color: "#16a34a", marginTop: 1, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "#166534", fontFamily: "monospace", fontWeight: 600, lineHeight: 1.4 }}>
                    {sourceMeta[activeMode] ||
                      (activeMode === "air" ? airData?.source_label : undefined) ||
                      "Real-time API"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
