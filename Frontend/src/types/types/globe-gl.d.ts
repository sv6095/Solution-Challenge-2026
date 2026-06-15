declare module 'globe.gl' {
  export interface ConfigOptions {
    [key: string]: unknown;
  }

  export interface GlobeInstance {
    pointOfView(pov?: { lat?: number; lng?: number; altitude?: number }, transitionMs?: number): { lat: number; lng: number; altitude: number };
    toGlobeCoords(x: number, y: number): { lat: number; lng: number } | null;
    globeImageUrl(url: string): GlobeInstance;
    htmlElementsData(data: unknown[]): GlobeInstance;
    scene(): unknown;
    controls(): unknown;
    camera(): unknown;
    renderer(): unknown;
    width(w?: number): unknown;
    height(h?: number): unknown;
    pauseAnimation(): GlobeInstance;
    resumeAnimation(): GlobeInstance;
    [method: string]: unknown;
  }

  const Globe: {
    new (element: HTMLElement, config?: ConfigOptions): GlobeInstance;
  };

  export default Globe;
}

declare module 'react-globe.gl' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Globe: any;
  export default Globe;
}
