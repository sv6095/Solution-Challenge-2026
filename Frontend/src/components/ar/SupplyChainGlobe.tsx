import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import type { ArAssetDisruption, ArAssetNode, ArAssetRoute } from "@/lib/api";
import { fmtINR } from "@/lib/currency";


const MODE_COLORS: Record<string, string> = {
  sea: "#2563eb",
  air: "#f8fafc",
  land: "#f59e0b",
};

const modeLabel = (mode: string) => {
  const normalized = String(mode || "land").toLowerCase();
  if (normalized === "sea") return "Sea";
  if (normalized === "air") return "Air";
  return "Land";
};

const nodeLabel = (node: ArAssetNode) => {
  const type = String(node.type || "supplier").toLowerCase();
  if (type === "supplier") return "Supplier node";
  if (type === "customer") return "Customer node";
  if (type === "logistics") return "Logistics node";
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} node`;
};

const fmtMoney = fmtINR;


const fmtDelta = (value: number, unit = "") => {
  const n = Number.isFinite(value) ? value : 0;
  return `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString()}${unit}`;
};

function routeMidpoint(route: ArAssetRoute) {
  return {
    ...route,
    lat: (route.startLat + route.endLat) / 2,
    lng: (route.startLng + route.endLng) / 2,
  };
}

function buildRouteLabel(route: ArAssetRoute): HTMLElement {
  const el = document.createElement("div");
  const color = MODE_COLORS[String(route.mode).toLowerCase()] ?? MODE_COLORS.land;
  el.className = "pointer-events-none rounded border border-white/15 bg-slate-950/80 px-2 py-1 text-[10px] font-semibold text-white shadow-xl backdrop-blur";
  el.style.transform = "translate(-50%, -120%)";
  el.style.borderLeft = `3px solid ${color}`;
  el.innerHTML = `
    <div style="letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1">${modeLabel(route.mode)} route</div>
    <div>${fmtMoney(route.cost_usd)} <span style="color:#94a3b8">cost</span></div>
    <div style="color:${route.co2_delta_kg <= 0 ? "#86efac" : "#fca5a5"}">${fmtDelta(route.co2_delta_kg, " kg")} CO2</div>
  `;
  return el;
}

type HtmlGlobeItem = {
  id: string;
  lat: number;
  lng: number;
  kind: "route" | "incident";
  route?: ArAssetRoute;
  disruption?: ArAssetDisruption;
};

function buildIncidentMarker(
  disruption: ArAssetDisruption,
  selected: boolean,
  onClick?: (disruption: ArAssetDisruption) => void,
): HTMLElement {
  const el = document.createElement("div");
  const sev = String(disruption.severity || "").toUpperCase();
  const critical = sev === "CRITICAL";
  el.className = "cursor-pointer";
  el.style.transform = "translate(-50%, -50%)";
  el.style.pointerEvents = "auto";
  el.innerHTML = `
    <div style="position:relative;width:28px;height:28px">
      ${critical ? '<span style="position:absolute;inset:0;border-radius:9999px;background:rgba(239,68,68,0.25);animation:pulse 1.5s ease-in-out infinite"></span>' : ""}
      <span style="
        position:absolute;left:8px;top:8px;width:12px;height:12px;border-radius:9999px;
        border:2px solid #fff;background:${critical ? "#ef4444" : "#fbbf24"};
        box-shadow:0 0 14px ${critical ? "rgba(239,68,68,0.9)" : "rgba(251,191,36,0.8)"};
        ${selected ? "outline:2px solid #3b82f6;outline-offset:2px;transform:scale(1.2)" : ""}
      "></span>
    </div>
  `;
  el.title = disruption.title;
  if (onClick) {
    el.onclick = (event) => {
      event.stopPropagation();
      onClick(disruption);
    };
  }
  return el;
}

export type SupplyChainGlobeProps = {
  nodes: ArAssetNode[];
  routes: ArAssetRoute[];
  disruptions: ArAssetDisruption[];
  className?: string;
  selectedDisruptionId?: string | null;
  selectedNodeId?: string | null;
  onDisruptionClick?: (disruption: ArAssetDisruption) => void;
  onNodeClick?: (node: ArAssetNode) => void;
  autoRotate?: boolean;
  showRouteLabels?: boolean;
  showLegend?: boolean;
  focusKey?: string | number;
};

export function SupplyChainGlobe({
  nodes,
  routes,
  disruptions,
  className = "",
  selectedDisruptionId = null,
  selectedNodeId = null,
  onDisruptionClick,
  onNodeClick,
  autoRotate = true,
  showRouteLabels = true,
  showLegend = true,
  focusKey,
}: SupplyChainGlobeProps) {
  const globeRef = useRef<any>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [globeSize, setGlobeSize] = useState({ width: 960, height: 620 });

  const activeRoutes = useMemo(() => routes.filter((route) => route.active), [routes]);
  const supplierNodes = useMemo(
    () => nodes.filter((node) => String(node.type || "").toLowerCase() === "supplier"),
    [nodes],
  );

  const htmlElements = useMemo<HtmlGlobeItem[]>(() => {
    const items: HtmlGlobeItem[] = disruptions.map((disruption) => ({
      id: `inc-${disruption.id}`,
      lat: disruption.lat,
      lng: disruption.lng,
      kind: "incident" as const,
      disruption,
    }));
    if (showRouteLabels) {
      activeRoutes.forEach((route) => {
        const mid = routeMidpoint(route);
        items.push({
          id: `route-${route.id}`,
          lat: mid.lat,
          lng: mid.lng,
          kind: "route" as const,
          route,
        });
      });
    }
    return items;
  }, [activeRoutes, disruptions, showRouteLabels]);

  const nodeColor = useCallback((node: ArAssetNode) => {
    const type = String(node.type || "supplier").toLowerCase();
    if (type === "customer") return "#38bdf8";
    if (type === "logistics") return "#c084fc";
    const score = Number(node.exposureScore ?? 50);
    if (score >= 75 || node.criticality === "critical") return "#ef4444";
    if (score >= 60 || node.criticality === "high") return "#f59e0b";
    return "#22c55e";
  }, []);

  const nodeAltitude = useCallback((node: ArAssetNode) => {
    const base = 0.035 + Math.min(0.05, Number(node.exposureScore ?? 50) / 2000);
    return String(node.type || "supplier").toLowerCase() === "supplier" ? base + 0.01 : base;
  }, []);

  const nodeRadius = useCallback((node: ArAssetNode) => {
    const base = Math.max(0.18, Math.min(0.45, Number(node.exposureScore ?? 45) / 180));
    return String(node.type || "supplier").toLowerCase() === "supplier" ? base + 0.05 : base;
  }, []);

  const ringColor = useCallback((disruption: ArAssetDisruption) => {
    const sev = String(disruption.severity || "").toUpperCase();
    if (sev === "CRITICAL" || sev === "HIGH") return "rgba(239,68,68,0.95)";
    return "rgba(251,191,36,0.9)";
  }, []);

  const htmlElement = useCallback((item: HtmlGlobeItem) => {
    if (item.kind === "incident" && item.disruption) {
      return buildIncidentMarker(
        item.disruption,
        String(item.disruption.id) === String(selectedDisruptionId),
        onDisruptionClick,
      );
    }
    if (item.kind === "route" && item.route) return buildRouteLabel(item.route);
    return document.createElement("div");
  }, [onDisruptionClick, selectedDisruptionId]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setGlobeSize({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(280, Math.round(rect.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.controls().autoRotate = autoRotate;
    globe.controls().autoRotateSpeed = 0.45;
  }, [autoRotate, focusKey]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const selectedNode = selectedNodeId
      ? nodes.find((n) => String(n.id) === String(selectedNodeId))
      : null;
    if (selectedNode) {
      globe.pointOfView({ lat: selectedNode.lat, lng: selectedNode.lng, altitude: 1.5 }, 900);
      return;
    }

    const selected = selectedDisruptionId
      ? disruptions.find((d) => String(d.id) === String(selectedDisruptionId))
      : null;

    if (selected) {
      globe.pointOfView({ lat: selected.lat, lng: selected.lng, altitude: 1.65 }, 900);
      return;
    }

    const focusPoints = disruptions.length
      ? disruptions
      : nodes.length
        ? nodes
        : [{ lat: 18, lng: 72 }];

    const lat = focusPoints.reduce((sum, p) => sum + Number(p.lat), 0) / focusPoints.length;
    const lng = focusPoints.reduce((sum, p) => sum + Number(p.lng), 0) / focusPoints.length;
    globe.pointOfView({ lat, lng, altitude: disruptions.length ? 2.0 : 2.15 }, 900);
  }, [disruptions, focusKey, nodes, selectedDisruptionId, selectedNodeId]);

  return (
    <div ref={shellRef} className={`relative overflow-hidden bg-slate-950 ${className}`}>
      <Globe
        ref={globeRef}
        width={globeSize.width}
        height={globeSize.height}
        backgroundColor="rgba(2,6,23,1)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        pointsData={nodes}
        pointLat="lat"
        pointLng="lng"
        pointAltitude={nodeAltitude}
        pointRadius={nodeRadius}
        pointColor={nodeColor}
        pointLabel={(node: ArAssetNode) =>
          `${nodeLabel(node)}<br/>${node.name}<br/>${node.country || "Unknown"}<br/>${node.tier || node.type}`
        }
        onPointClick={(node: object) => {
          if (onNodeClick) onNodeClick(node as ArAssetNode);
        }}
        arcsData={activeRoutes}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={(route: ArAssetRoute) => MODE_COLORS[String(route.mode).toLowerCase()] ?? MODE_COLORS.land}
        arcStroke={(route: ArAssetRoute) => Math.max(0.35, Math.min(2.8, Number(route.confidence ?? 0.5) * 2.6))}
        arcDashLength={0.36}
        arcDashGap={0.7}
        arcDashInitialGap={() => Math.random()}
        arcDashAnimateTime={(route: ArAssetRoute) => String(route.mode).toLowerCase() === "air" ? 1200 : 2200}
        htmlElementsData={htmlElements}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={0.06}
        htmlElement={htmlElement}
        ringsData={disruptions}
        ringLat="lat"
        ringLng="lng"
        ringColor={ringColor}
        ringLabel={(disruption: ArAssetDisruption) => `<b>${disruption.title}</b><br/>${disruption.severity}${disruption.exposure_usd ? `<br/>${fmtMoney(disruption.exposure_usd)} exposure` : ""}`}
        ringMaxRadius={(disruption: ArAssetDisruption) => Math.max(2, Math.min(8, Number(disruption.radius_km ?? 150) / 60))}
        ringPropagationSpeed={1.6}
        ringRepeatPeriod={850}
      />
      {showLegend && (
        <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2">
          {Object.entries(MODE_COLORS).map(([mode, color]) => (
            <span key={mode} className="rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
              <span className="mr-1 inline-block size-2 rounded-full" style={{ background: color }} />
              {mode}
            </span>
          ))}
          {supplierNodes.length > 0 && (
            <span className="rounded border border-emerald-400/30 bg-slate-950/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
              {supplierNodes.length} supplier node{supplierNodes.length === 1 ? "" : "s"}
            </span>
          )}
          {disruptions.length > 0 && (
            <span className="rounded border border-red-500/30 bg-slate-950/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-300">
              {disruptions.length} incident{disruptions.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
