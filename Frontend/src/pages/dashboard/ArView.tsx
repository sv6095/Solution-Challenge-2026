import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, RadioTower, RefreshCw } from "lucide-react";
import { api, getUserId } from "@/lib/api";
import { useWebSocket } from "@/hooks/use-websocket";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { SupplyChainGlobe } from "@/components/ar/SupplyChainGlobe";
import { IncidentFlyoverMap } from "@/components/ar/IncidentFlyoverMap";
import type { ArAssetDisruption, ArAssetNode } from "@/lib/api";

export default function ArView() {
  const queryClient = useQueryClient();
  const tenantId = getUserId();
  const { lastEvent } = useWebSocket(tenantId);
  const [selectedDisruption, setSelectedDisruption] = useState<ArAssetDisruption | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeFocusTick, setSelectedNodeFocusTick] = useState(0);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["ar", "assets"],
    queryFn: api.ar.assets,
    staleTime: 15 * 60 * 1000,
  });

  const { data: mapsConfig } = useQuery({
    queryKey: ["config", "maps"],
    queryFn: api.config.maps,
    staleTime: 5 * 60_000,
    enabled: Boolean(selectedDisruption),
  });

  useEffect(() => {
    if (!lastEvent) return;
    if (["incident_created", "incident_updated", "incident_resolved", "signal_detected", "worldmonitor_updated"].includes(lastEvent.type)) {
      void queryClient.invalidateQueries({ queryKey: ["ar", "assets"] });
    }
  }, [lastEvent, queryClient]);

  const nodes = data?.nodes ?? [];
  const routes = data?.routes ?? [];
  const disruptions = data?.disruptions ?? [];
  const hasGlobeData = nodes.length > 0 || disruptions.length > 0;
  const selectedDisruptionId = selectedDisruption?.id ?? null;
  const mapsApiKey = mapsConfig?.google_maps_api_key || import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const onNodeClick = useCallback((node: ArAssetNode) => {
    setSelectedNodeId(String(node.id));
    setSelectedNodeFocusTick((tick) => tick + 1);
    const nodeType = String(node.type || "supplier").toLowerCase();
    toast.success(
      `${nodeType === "supplier" ? "Supplier node" : `${nodeType.charAt(0).toUpperCase()}${nodeType.slice(1)} node`} selected`,
      {
        description: `${node.name}${node.country ? ` | ${node.country}` : ""}${typeof node.exposureScore === "number" ? ` | Exposure ${Math.round(node.exposureScore)}` : ""}`,
      },
    );
  }, []);

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
          <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
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
      ) : !hasGlobeData ? (
        <div className="flex h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card text-center">
          <RadioTower size={28} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">No supplier coordinates available.</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Add suppliers or save a workflow network with lat/lng nodes to populate the globe.
          </p>
        </div>
      ) : (
        selectedDisruption ? (
          <IncidentFlyoverMap
            apiKey={mapsApiKey}
            disruption={selectedDisruption}
            nodes={nodes}
            routes={routes}
            onBack={() => setSelectedDisruption(null)}
          />
        ) : (
          <SupplyChainGlobe
            nodes={nodes}
            routes={[]}
            disruptions={disruptions}
            className="h-[min(72vh,720px)] min-h-[520px] rounded-lg border border-slate-800"
            focusKey={`${data?.updated_at ?? ""}:${selectedNodeFocusTick}`}
            selectedDisruptionId={selectedDisruptionId}
            selectedNodeId={selectedNodeId}
            onDisruptionClick={setSelectedDisruption}
            onNodeClick={onNodeClick}
            showRouteLabels={false}
          />
        )
      )}
    </div>
  );
}
