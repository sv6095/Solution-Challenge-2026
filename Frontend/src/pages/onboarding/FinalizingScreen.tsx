import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface FinalizingScreenProps {
  nodeCount: number;
  onCancel: () => void;
  onComplete: () => void;
}

export default function FinalizingScreen({ nodeCount, onCancel, onComplete }: FinalizingScreenProps) {
  const [logs, setLogs] = useState<string[]>([
    'Initializing secure V-Net protocol...'
  ]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const logsToInsert = [
    'Establishing connection to master cluster...',
    `Parsing spatial definitions for ${nodeCount} nodes...`,
    'Validating EPSG:4326 coordinate projections...',
    '[OK] LAT/LONG VALIDATED',
    'Constructing logical tier hierarchy...',
    'Checking redundancy constraints...',
    'Evaluating cross-node latency matrices...',
    '[OK] TIER HIERARCHY MAPPED',
    'Generating cryptographic hash signatures...',
    'Preparing atomic transaction batch...',
    'Opening secure channel to primary datastore...',
    '[SYNC] COMMITTING TO FIRESTORE...',
    'Awaiting write acknowledgment...',
    'Verifying checksum integrity...',
    'Synchronizing global state registry...',
    'Finalizing architecture blueprint...'
  ];

  // Ingest logs sequentially with a realistic premium speed
  useEffect(() => {
    let active = true;
    let index = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    
    const addNextLog = () => {
      if (!active) return;
      if (index < logsToInsert.length) {
        const nextLog = logsToInsert[index];
        if (nextLog) {
          setLogs((prev) => [...prev, nextLog]);
        }
        index++;
        
        // Random timeout between 200ms and 750ms to look realistic and fast
        const randomDelay = Math.random() * 550 + 200;
        timeoutId = setTimeout(addNextLog, randomDelay);
      } else {
        // Completion flow trigger
        timeoutId = setTimeout(() => {
          if (active) {
            onComplete();
          }
        }, 1200);
      }
    };

    // Begin sequence after a 1 second initial pause
    timeoutId = setTimeout(addNextLog, 1000);

    return () => {
      active = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [nodeCount]);

  // Keep terminal scrolled to the bottom
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div id="finalizing-sync-screen" className="bg-[#f9f9f9] text-[#1a1c1c] min-h-screen flex flex-col justify-center items-center p-6 md:p-12 relative selection:bg-rose-100 selection:text-rose-900 font-sans">
      
      {/* Injecting CSS dependencies & styles directly for self-contained, perfect visual alignment */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400&family=Hanken+Grotesk:wght@600;700;800&family=JetBrains+Mono:wght@500&display=swap');

        .font-geist-body {
          font-family: 'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif;
        }
        .font-hanken-display {
          font-family: 'Hanken Grotesk', ui-sans-serif, system-ui, -apple-system, sans-serif;
          letter-spacing: -0.02em;
        }
        .font-jb-mono {
          font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }

        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(110%); }
        }
        .custom-scanline {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 20px;
          background: linear-gradient(to bottom, rgba(184, 0, 53, 0) 0%, rgba(184, 0, 53, 0.08) 50%, rgba(184, 0, 53, 0) 100%);
          animation: scanline 4s linear infinite;
          pointer-events: none;
          z-index: 10;
        }

        @keyframes pulse-ring {
          0% { transform: scale(0.8); opacity: 0.25; }
          50% { transform: scale(1.15); opacity: 0.04; }
          100% { transform: scale(0.8); opacity: 0.25; }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .custom-loader-ring {
          border: 2px solid #b80035;
          border-top-color: transparent;
          border-bottom-color: transparent;
          border-radius: 50%;
          animation: spin-slow 3s linear infinite;
        }
        .custom-loader-ring-inner {
          border: 1px dashed #1a1c1c;
          border-radius: 50%;
          animation: spin-slow 5s linear infinite reverse;
        }
        .custom-loader-pulse {
          background-color: #b80035;
          border-radius: 50%;
          animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        /* Subtle scrollbar styling matches brutalist UI aesthetic */
        .terminal-scroll-custom::-webkit-scrollbar {
          width: 4px;
        }
        .terminal-scroll-custom::-webkit-scrollbar-track {
          background: #ffffff;
        }
        .terminal-scroll-custom::-webkit-scrollbar-thumb {
          background: #e2e2e2;
        }
      `}</style>

      {/* Content Canvas */}
      <main className="w-full max-w-3xl flex flex-col items-center text-center z-10 py-8">
        
        {/* Prominent Technical Animation */}
        <div className="relative w-40 h-40 mb-12 flex items-center justify-center">
          <div className="absolute inset-0 custom-loader-pulse"></div>
          <div className="absolute inset-2 custom-loader-ring"></div>
          <div className="absolute inset-8 custom-loader-ring-inner"></div>
          
          {/* Earth/Public high-fidelity Vector Graphic replacing Google Font Icon safely */}
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="#b80035" 
            strokeWidth="1.5" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            className="w-12 h-12 relative z-10 transition-transform duration-300 transform hover:scale-110"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
            <path d="M12 2c-.3 1.6-.5 3.3-.5 5 0 1.2.1 2.3.3 3.5m.4 3c.3 1.6.5 3.3.5 5 0 .2 0 .4-.1.6" />
          </svg>
        </div>

        {/* Typography pair */}
        <h1 className="font-hanken-display text-4xl md:text-[46px] font-extrabold text-[#1a1c1c] mb-5 tracking-tight leading-none">
          Finalizing Network Architecture
        </h1>
        <p className="font-geist-body text-base md:text-lg text-[#5c3f40] max-w-2xl mx-auto mb-12 leading-relaxed">
          Running geospatial validation and committing {nodeCount} nodes to the primary database...
        </p>

        {/* Monospaced Progress Log (Brutalist styling with custom scanline effect) */}
        <div className="w-full max-w-2xl border border-[#1a1c1c] bg-white p-5 md:p-6 text-left relative h-64 md:h-72 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col">
          <div className="custom-scanline"></div>
          
          {/* Subtle top/bottom fading masks */}
          <div className="absolute top-0 left-0 w-full h-10 bg-gradient-to-b from-white to-transparent pointer-events-none z-10"></div>
          <div className="absolute bottom-0 left-0 w-full h-10 bg-gradient-to-t from-white to-transparent pointer-events-none z-10"></div>

          {/* Interactive logs content container */}
          <div className="w-full h-full overflow-y-auto terminal-scroll-custom pr-2 py-4 flex flex-col text-left">
            <ul className="font-jb-mono text-xs text-[#5c3f40] space-y-3 flex flex-col">
              {logs.map((log, idx) => {
                if (!log || typeof log !== 'string') return null;
                let formattedText = log;
                if (log.includes('[OK]')) {
                  formattedText = log.replace('[OK]', '<span class="text-[#b80035] font-bold">[OK]</span>');
                } else if (log.includes('[SYNC]')) {
                  formattedText = log.replace('[SYNC]', '<span class="text-[#b80035] font-bold animate-pulse">[SYNC]</span>');
                }

                return (
                  <li key={idx} className="flex items-start">
                    <span className="opacity-40 mr-2 shrink-0 select-none">&gt;</span>
                    <span 
                      className="leading-relaxed" 
                      dangerouslySetInnerHTML={{ __html: formattedText }}
                    />
                  </li>
                );
              })}
              <div ref={terminalEndRef} />
            </ul>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-12">
          <button
            onClick={onCancel}
            type="button"
            className="px-8 py-3 border border-[#1a1c1c] text-[#1a1c1c] font-jb-mono text-[13px] uppercase tracking-wider bg-transparent hover:bg-[#e2e2e2] active:bg-[#d6d6d6] transition-colors focus:outline-none focus:ring-1 focus:ring-rose-500 flex items-center gap-3 cursor-pointer select-none"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="w-4 h-4"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <line x1="9" x2="15" y1="9" y2="15" />
              <line x1="15" x2="9" y1="9" y2="15" />
            </svg>
            Cancel Sync
          </button>
        </div>

      </main>

    </div>
  );
}
