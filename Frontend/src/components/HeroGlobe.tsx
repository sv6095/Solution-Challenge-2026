import React, { useEffect, useRef, useState } from "react";
import Globe from "react-globe.gl";

export function HeroGlobe() {
  const globeRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight || 600,
        });
      }
    };
    window.addEventListener("resize", updateSize);
    updateSize();
    // Slight delay to ensure parent has rendered and has a size
    setTimeout(updateSize, 100);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    if (globeRef.current) {
      globeRef.current.controls().autoRotate = true;
      globeRef.current.controls().autoRotateSpeed = 0.5;
      globeRef.current.controls().enableZoom = false;
      globeRef.current.pointOfView({ lat: 22.3193, lng: 114.1694, altitude: 2 });
    }
  }, []);

  // Red theme matching text-red-500
  const colors = ["#ef4444", "#dc2626", "#b91c1c", "#f87171"];

  const sampleArcs = [
    { startLat: -19.885592, startLng: -43.951191, endLat: -22.9068, endLng: -43.1729, arcAlt: 0.1 },
    { startLat: 3.139, startLng: 101.6869, endLat: 28.6139, endLng: 77.209, arcAlt: 0.2 }, // Reversed
    { startLat: 51.5072, startLng: -0.1276, endLat: 3.139, endLng: 101.6869, arcAlt: 0.3 },
    { startLat: 36.162809, startLng: -115.119411, endLat: -15.785493, endLng: -47.909029, arcAlt: 0.3 }, // Reversed
    { startLat: -33.8688, startLng: 151.2093, endLat: 22.3193, endLng: 114.1694, arcAlt: 0.3 },
    { startLat: 48.8566, startLng: -2.3522, endLat: 34.0522, endLng: -118.2437, arcAlt: 0.2 } // Reversed
  ].map((arc, i) => ({
    ...arc,
    color: colors[i % colors.length]
  }));

  const samplePoints = sampleArcs.flatMap(arc => [
    { lat: arc.startLat, lng: arc.startLng },
    { lat: arc.endLat, lng: arc.endLng }
  ]);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[400px] md:min-h-[600px] cursor-grab active:cursor-grabbing bg-black relative overflow-hidden flex items-center justify-center rounded-xl">
      <Globe
        ref={globeRef}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0,0,0,1)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg" // Dark globe with light areas
        arcsData={sampleArcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor="color"
        arcStroke={1.5} // Make arcs thicker
        arcDashLength={0.9} // One long continuous line
        arcDashGap={2} // Large gap so only one line flows at a time
        arcDashInitialGap={() => Math.random()} // Randomize start times
        arcDashAnimateTime={1500}
        arcAltitude="arcAlt"
        atmosphereColor="#ef4444"
        atmosphereAltitude={0.15}
        pointsData={samplePoints}
        pointLat="lat"
        pointLng="lng"
        pointColor={() => "#ef4444"}
        pointAltitude={0}
        pointRadius={1.5} // Thicker points
      />
      <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_40px_rgba(0,0,0,1)]" />
    </div>
  );
}
