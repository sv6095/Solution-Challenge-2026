import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, MapPin } from "lucide-react";
import { fmtINR } from "@/lib/currency";

import { Button } from "@/components/ui/button";
import type { ArAssetDisruption, ArAssetNode, ArAssetRoute } from "@/lib/api";


declare global {
  interface Window {
    google?: any;
    __praecantatorGoogleMapsPromise?: Promise<any>;
  }
}

const DEFAULT_API_ERROR = "Google Maps JavaScript API key is not configured.";

function loadGoogleMaps(apiKey: string): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__praecantatorGoogleMapsPromise) return window.__praecantatorGoogleMapsPromise;

  window.__praecantatorGoogleMapsPromise = new Promise((resolve, reject) => {
    // Use the recommended `loading=async` pattern per Google Maps JS API best practices.
    // A unique callback name is registered on window so the API signals readiness.
    const callbackName = "__praecantatorGoogleMapsCallback";
    (window as any)[callbackName] = () => resolve(window.google?.maps);

    const existing = document.querySelector<HTMLScriptElement>("script[data-praecantator-google-maps]");
    if (existing) {
      // Script already injected — wait for callback or error.
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps JavaScript API.")));
      return;
    }

    const script = document.createElement("script");
    // `loading=async` is the recommended best-practice flag (suppresses the console warning).
    // `language=en` ensures all map UI text (labels, controls) is rendered in English.
    script.src = [
      `https://maps.googleapis.com/maps/api/js`,
      `?key=${encodeURIComponent(apiKey)}`,
      `&v=weekly`,
      `&loading=async`,
      `&language=en`,
      `&callback=${callbackName}`,
    ].join("");
    script.async = true;
    script.dataset.praecantatorGoogleMaps = "true";
    script.onerror = () => reject(new Error("Failed to load Google Maps JavaScript API."));
    document.head.appendChild(script);
  });

  return window.__praecantatorGoogleMapsPromise;
}

const fmtMoney = fmtINR;

const riskColor = (score?: number, criticality?: string) => {
  const value = Number(score ?? 50);
  if (value >= 75 || String(criticality || "").toLowerCase() === "critical") return "#ef4444";
  if (value >= 60 || String(criticality || "").toLowerCase() === "high") return "#f59e0b";
  return "#22c55e";
};

const markerSvg = (color: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
      <path fill="${color}" stroke="white" stroke-width="2" d="M17 1C8.7 1 2 7.7 2 16c0 11.2 15 25 15 25s15-13.8 15-25C32 7.7 25.3 1 17 1Z"/>
      <circle cx="17" cy="16" r="5" fill="white"/>
    </svg>
  `)}`;

function routeCo2Delta(disruption: ArAssetDisruption, routes: ArAssetRoute[]) {
  const recommended = disruption.route_options?.find((route) => Boolean(route?.recommended)) ?? disruption.route_options?.[0];
  const fromIncident = Number(recommended?.co2_delta_kg ?? recommended?.co2_delta ?? recommended?.carbon_delta_kg);
  if (Number.isFinite(fromIncident) && fromIncident !== 0) return fromIncident;

  const bestRoute = routes
    .filter((route) => route.active)
    .sort((a, b) => Number(a.co2_delta_kg ?? 0) - Number(b.co2_delta_kg ?? 0))[0];
  return Number(bestRoute?.co2_delta_kg ?? 0);
}

function supplierMatchesIncident(node: ArAssetNode, disruption: ArAssetDisruption) {
  const ids = [
    ...(disruption.affected_nodes ?? []),
    ...(disruption.affected_suppliers ?? []),
  ].map((item) => String(item?.id ?? item?.node_id ?? item?.supplier_id ?? ""));
  return ids.includes(String(node.id));
}

export type IncidentFlyoverMapProps = {
  apiKey?: string;
  disruption: ArAssetDisruption;
  nodes: ArAssetNode[];
  routes: ArAssetRoute[];
  onBack: () => void;
};

export function IncidentFlyoverMap({ apiKey, disruption, nodes, routes, onBack }: IncidentFlyoverMapProps) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<{ markers: any[]; circle?: any; info?: any; timer?: number }>({ markers: [] });
  const [loadError, setLoadError] = useState<string | null>(apiKey === "" ? DEFAULT_API_ERROR : null);
  const [loading, setLoading] = useState(apiKey === undefined || Boolean(apiKey));

  const relevantSuppliers = useMemo(() => {
    const suppliers = nodes.filter((node) => String(node.type || "").toLowerCase() === "supplier");
    const matched = suppliers.filter((node) => supplierMatchesIncident(node, disruption));
    return matched.length ? matched : suppliers;
  }, [disruption, nodes]);

  const highestRiskSupplier = useMemo(() => {
    return [...relevantSuppliers].sort((a, b) => Number(b.exposureScore ?? 0) - Number(a.exposureScore ?? 0))[0];
  }, [relevantSuppliers]);

  const co2Delta = useMemo(() => routeCo2Delta(disruption, routes), [disruption, routes]);

  useEffect(() => {
    if (apiKey === undefined) {
      setLoadError(null);
      setLoading(true);
      return;
    }

    if (!apiKey) {
      setLoadError(DEFAULT_API_ERROR);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !mapEl.current) return;

        const center = { lat: Number(disruption.lat), lng: Number(disruption.lng) };
        const map = mapRef.current ?? new maps.Map(mapEl.current, {
          center,
          zoom: 4,
          mapTypeId: "hybrid",
          tilt: 67.5,
          heading: 30,
          disableDefaultUI: false,
          fullscreenControl: false,
          streetViewControl: false,
          mapTypeControl: false,
        });

        mapRef.current = map;
        overlaysRef.current.markers.forEach((marker) => marker.setMap(null));
        overlaysRef.current.circle?.setMap(null);
        overlaysRef.current.info?.close();
        if (overlaysRef.current.timer) window.clearInterval(overlaysRef.current.timer);
        overlaysRef.current = { markers: [] };

        map.setMapTypeId("hybrid");
        map.setTilt(67.5);
        map.setHeading(30);
        map.panTo(center);
        window.setTimeout(() => {
          map.setZoom(13);
          map.setTilt(67.5);
          map.setHeading(30);
        }, 250);

        const circle = new maps.Circle({
          map,
          center,
          radius: Math.max(1200, Math.min(9000, Number(disruption.radius_km ?? 4) * 220)),
          fillColor: "#ef4444",
          fillOpacity: 0.18,
          strokeColor: "#ef4444",
          strokeOpacity: 0.85,
          strokeWeight: 2,
        });

        let pulse = 0;
        const timer = window.setInterval(() => {
          pulse = (pulse + 1) % 32;
          const wave = Math.sin((pulse / 32) * Math.PI);
          circle.setRadius(Math.max(1200, Math.min(9000, Number(disruption.radius_km ?? 4) * 220)) * (1 + wave * 0.32));
          circle.setOptions({ fillOpacity: 0.2 - wave * 0.11, strokeOpacity: 0.9 - wave * 0.25 });
        }, 70);

        const markers = relevantSuppliers.map((node) => new maps.Marker({
          map,
          position: { lat: Number(node.lat), lng: Number(node.lng) },
          title: node.name,
          icon: {
            url: markerSvg(riskColor(node.exposureScore, node.criticality)),
            scaledSize: new maps.Size(34, 42),
            anchor: new maps.Point(17, 42),
          },
        }));

        if (highestRiskSupplier) {
          const risk = Number(highestRiskSupplier.exposureScore ?? 0);
          const info = new maps.InfoWindow({
            content: `
              <div style="min-width:240px;font-family:Inter,system-ui,sans-serif;color:#111827">
                <div style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#dc2626">Highest-risk supplier</div>
                <div style="margin-top:4px;font-size:14px;font-weight:800">${highestRiskSupplier.name}</div>
                <div style="margin-top:2px;font-size:12px;color:#4b5563">${highestRiskSupplier.country || highestRiskSupplier.tier || "Supplier node"} · Risk ${Math.round(risk)}</div>
                <div style="margin-top:10px;display:grid;gap:6px;font-size:12px">
                  <div><b>Exposure:</b> ${fmtMoney(disruption.exposure_usd || highestRiskSupplier.daily_throughput_usd || 0)}</div>
                  <div><b>Days to stockout:</b> ${Number(disruption.min_stockout_days || 0).toFixed(1)}</div>
                  <div><b>CO2 route delta:</b> ${co2Delta > 0 ? "+" : ""}${Math.round(co2Delta).toLocaleString()} kg</div>
                </div>
              </div>
            `,
          });
          const marker = markers.find((item, idx) => relevantSuppliers[idx]?.id === highestRiskSupplier.id);
          if (marker) {
            info.open({ map, anchor: marker });
            marker.addListener("click", () => info.open({ map, anchor: marker }));
          }
          overlaysRef.current.info = info;
        }

        overlaysRef.current.markers = markers;
        overlaysRef.current.circle = circle;
        overlaysRef.current.timer = timer;
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      overlaysRef.current.markers.forEach((marker) => marker.setMap(null));
      overlaysRef.current.circle?.setMap(null);
      overlaysRef.current.info?.close();
      if (overlaysRef.current.timer) window.clearInterval(overlaysRef.current.timer);
    };
  }, [apiKey, co2Delta, disruption, highestRiskSupplier, relevantSuppliers]);

  return (
    <div className="relative h-[min(72vh,720px)] min-h-[520px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
      <div ref={mapEl} className="absolute inset-0" />

      <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onBack} className="bg-white/95 text-slate-950 hover:bg-white">
          <ArrowLeft size={14} />
          Back to Globe
        </Button>
        <div className="rounded border border-white/15 bg-slate-950/80 px-3 py-2 text-white shadow-xl backdrop-blur">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300">
            <MapPin size={12} />
            3D incident flyover
          </div>
          <div className="mt-1 max-w-[min(420px,70vw)] truncate text-sm font-semibold">{disruption.title}</div>
        </div>
      </div>

      <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-2">
        {[
          ["#ef4444", "High"],
          ["#f59e0b", "Elevated"],
          ["#22c55e", "Stable"],
        ].map(([color, label]) => (
          <span key={label} className="rounded border border-white/10 bg-slate-950/75 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="mr-1 inline-block size-2 rounded-full" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      {(loading || loadError) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-6 text-center text-white backdrop-blur">
          {loading ? (
            <div className="flex items-center gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Loading Google Maps 3D flyover...
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold">{loadError}</p>
              <p className="mt-2 text-xs text-slate-300">Set GOOGLE_MAPS_API_KEY in the backend environment to enable this view.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
