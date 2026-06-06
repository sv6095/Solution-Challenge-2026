import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Globe from "react-globe.gl";
import { Box, Globe2, Map as MapIcon, RadioTower, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { api, getUserId, type ArAssetDisruption, type ArAssetNode, type ArAssetRoute } from "@/lib/api";
import { useWebSocket } from "@/hooks/use-websocket";
import { Button } from "@/components/ui/button";
import { Map, MapMarker, MarkerContent, useMap } from "@/components/ui/map";
import type MapLibreGL from "maplibre-gl";

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

const fmtMoney = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

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

function buildHtmlLabel(route: ArAssetRoute): HTMLElement {
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

function FlatRouteLayer({ routes }: { routes: ArAssetRoute[] }) {
  const { map, isLoaded } = useMap();
  const sourceId = "ar-flat-routes";
  const layerId = "ar-flat-routes-layer";

  const geo = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => ({
    type: "FeatureCollection",
    features: routes.filter((route) => route.active).map((route) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[route.startLng, route.startLat], [route.endLng, route.endLat]],
      },
      properties: {
        id: route.id,
        mode: route.mode,
        confidence: route.confidence,
      },
    })),
  }), [routes]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: geo });
    } else {
      (map.getSource(sourceId) as MapLibreGL.GeoJSONSource).setData(geo);
    }
    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "mode"],
            "sea", MODE_COLORS.sea,
            "air", MODE_COLORS.air,
            MODE_COLORS.land,
          ],
          "line-width": ["interpolate", ["linear"], ["get", "confidence"], 0, 1, 1, 6],
          "line-opacity": 0.72,
          "line-dasharray": [1.5, 1.2],
        },
      });
    }
  }, [geo, isLoaded, map]);

  useEffect(() => () => {
    if (!map) return;
    try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch { /* noop */ }
    try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch { /* noop */ }
  }, [map]);

  return null;
}

function FlatMapView({
  nodes,
  routes,
  disruptions,
}: {
  nodes: ArAssetNode[];
  routes: ArAssetRoute[];
  disruptions: ArAssetDisruption[];
}) {
  const center = useMemo<[number, number]>(() => {
    if (!nodes.length) return [0, 20];
    const lat = nodes.reduce((sum, node) => sum + node.lat, 0) / nodes.length;
    const lng = nodes.reduce((sum, node) => sum + node.lng, 0) / nodes.length;
    return [lng, lat];
  }, [nodes]);

  return (
    <div className="relative h-[min(72vh,720px)] min-h-[520px] overflow-hidden rounded-lg border border-border bg-card">
      <Map
        center={center}
        zoom={nodes.length > 2 ? 1.8 : 2.4}
        minZoom={1}
        maxZoom={8}
        theme="light"
        styles={{
          light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
          dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        }}
        className="absolute inset-0 h-full w-full"
      >
        <FlatRouteLayer routes={routes} />
        {nodes.map((node) => (
          <MapMarker key={node.id} longitude={node.lng} latitude={node.lat}>
            <MarkerContent className="rounded-full border border-white bg-slate-900 p-1 shadow-lg">
              <span className="block size-2 rounded-full bg-red-500" title={node.name} />
            </MarkerContent>
          </MapMarker>
        ))}
        {disruptions.map((disruption) => (
          <MapMarker key={disruption.id} longitude={disruption.lng} latitude={disruption.lat}>
            <MarkerContent className="relative size-7">
              <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
              <span className="absolute left-2 top-2 size-3 rounded-full bg-red-600 shadow-[0_0_18px_rgba(239,68,68,0.9)]" title={disruption.title} />
            </MarkerContent>
          </MapMarker>
        ))}
      </Map>
    </div>
  );
}

export default function ArView() {
  const [view, setView] = useState<"globe" | "flat">("globe");
  const [globeSize, setGlobeSize] = useState({ width: 960, height: 620 });
  const queryClient = useQueryClient();
  const tenantId = getUserId();
  const { lastEvent, isConnected } = useWebSocket(tenantId);
  const globeRef = useRef<any>(null);
  const globeShellRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["ar", "assets"],
    queryFn: api.ar.assets,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!lastEvent) return;
    if (["incident_created", "incident_updated", "incident_resolved", "signal_detected", "worldmonitor_updated"].includes(lastEvent.type)) {
      void queryClient.invalidateQueries({ queryKey: ["ar", "assets"] });
    }
  }, [lastEvent, queryClient]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.controls().autoRotate = true;
    globe.controls().autoRotateSpeed = 0.45;
    globe.pointOfView({ lat: 18, lng: 72, altitude: 2.15 }, 900);
  }, [data?.updated_at]);

  useEffect(() => {
    const el = globeShellRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setGlobeSize({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(420, Math.round(rect.height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const nodes = data?.nodes ?? [];
  const routes = data?.routes ?? [];
  const activeRoutes = routes.filter((route) => route.active);
  const disruptions = data?.disruptions ?? [];
  const labelData = useMemo(() => activeRoutes.map(routeMidpoint), [activeRoutes]);

  const nodeColor = useCallback((node: ArAssetNode) => {
    const score = Number(node.exposureScore ?? 50);
    if (score >= 75 || node.criticality === "critical") return "#ef4444";
    if (score >= 60 || node.criticality === "high") return "#f59e0b";
    return "#22c55e";
  }, []);

  const stats = [
    { label: "Supplier nodes", value: nodes.length },
    { label: "Active routes", value: activeRoutes.length },
    { label: "Disruptions", value: disruptions.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-headline font-bold uppercase tracking-[0.18em] text-red-500">
            <Box size={13} />
            Dashboard AR View
          </div>
          <h1 className="mt-1 font-headline text-2xl font-bold tracking-tight text-foreground">
            3D Supply Chain Globe
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-1">
            <Button size="sm" variant={view === "globe" ? "default" : "ghost"} onClick={() => setView("globe")} className="h-8">
              <Globe2 size={14} /> AR View
            </Button>
            <Button size="sm" variant={view === "flat" ? "default" : "ghost"} onClick={() => setView("flat")} className="h-8">
              <MapIcon size={14} /> Flat Map
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="grid grid-cols-3 gap-3">
          {stats.map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="text-[10px] font-headline font-bold uppercase tracking-widest text-muted-foreground">{item.label}</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-[10px] font-headline font-bold uppercase tracking-widest text-muted-foreground">
            {isConnected ? <Wifi size={13} className="text-green-500" /> : <WifiOff size={13} className="text-amber-500" />}
            {isConnected ? "Live WebSocket" : "Polling fallback"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Updated {data?.updated_at ? new Date(data.updated_at).toLocaleTimeString() : "pending"}
          </div>
        </div>
      </div>

      {isError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          Could not load AR assets from the backend.
        </div>
      )}

      {isLoading ? (
        <div className="flex h-[520px] items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
          Loading globe assets...
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card text-center">
          <RadioTower size={28} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">No supplier coordinates available.</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Add suppliers or save a workflow network with lat/lng nodes to populate the globe.
          </p>
        </div>
      ) : view === "flat" ? (
        <FlatMapView nodes={nodes} routes={activeRoutes} disruptions={disruptions} />
      ) : (
        <div ref={globeShellRef} className="relative h-[min(72vh,720px)] min-h-[520px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
          <Globe
            ref={globeRef}
            width={globeSize.width}
            height={globeSize.height}
            backgroundColor="rgba(2,6,23,1)"
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            pointsData={nodes}
            pointLat="lat"
            pointLng="lng"
            pointAltitude={(node: ArAssetNode) => 0.035 + Math.min(0.05, Number(node.exposureScore ?? 50) / 2000)}
            pointRadius={(node: ArAssetNode) => Math.max(0.18, Math.min(0.45, Number(node.exposureScore ?? 45) / 180))}
            pointColor={nodeColor}
            pointLabel={(node: ArAssetNode) => `${node.name}<br/>${node.country || "Unknown"}<br/>${node.tier || node.type}`}
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
            htmlElementsData={labelData}
            htmlLat="lat"
            htmlLng="lng"
            htmlAltitude={0.08}
            htmlElement={buildHtmlLabel}
            ringsData={disruptions}
            ringLat="lat"
            ringLng="lng"
            ringColor={() => "rgba(239,68,68,0.95)"}
            ringMaxRadius={(disruption: ArAssetDisruption) => Math.max(2, Math.min(8, Number(disruption.radius_km ?? 150) / 60))}
            ringPropagationSpeed={1.6}
            ringRepeatPeriod={850}
          />
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-wrap gap-2">
            {Object.entries(MODE_COLORS).map(([mode, color]) => (
              <span key={mode} className="rounded border border-white/10 bg-slate-950/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                <span className="mr-1 inline-block size-2 rounded-full" style={{ background: color }} />
                {mode}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
