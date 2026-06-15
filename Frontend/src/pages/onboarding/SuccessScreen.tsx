import React from 'react';
import { CheckCircle2, ChevronRight, Layers, ArrowRight, Activity, Database } from 'lucide-react';

interface SuccessScreenProps {
  nodeCount: number;
  onRestart: () => void;
}

export default function SuccessScreen({ nodeCount, onRestart }: SuccessScreenProps) {
  return (
    <div id="success-screen-bg" className="min-h-screen bg-[#fafafa] flex flex-col justify-center items-center py-12 px-4 font-sans text-gray-800">
      
      {/* Step Tracker centered on top as seen on screenshot 6 */}
      <div className="flex items-center space-x-12 relative w-full max-w-md mb-12">
        {/* Step 1 */}
        <div className="flex flex-col items-center flex-1 z-10">
          <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center font-mono text-sm font-semibold mb-2">
            ✓
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-gray-400 font-bold">
            Connect
          </span>
        </div>

        {/* Line 1 -> 2 */}
        <div className="absolute top-[15px] left-[15%] right-[55%] h-[1.5px] bg-emerald-500"></div>

        {/* Step 2 */}
        <div className="flex flex-col items-center flex-1 z-10">
          <span className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center font-mono text-sm font-semibold mb-2">
            ✓
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-gray-400 font-bold">
            Configure
          </span>
        </div>

        {/* Line 2 -> 3 */}
        <div className="absolute top-[15px] left-[50%] right-[18%] h-[1.5px] bg-emerald-500"></div>

        {/* Step 3 */}
        <div className="flex flex-col items-center flex-1 z-10">
          <span className="w-8 h-8 rounded-full bg-brand-red text-white flex items-center justify-center font-mono text-sm font-semibold mb-2">
            3
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-brand-red font-bold">
            Success
          </span>
        </div>
      </div>

      {/* Main Success Container card */}
      <div className="w-full max-w-xl bg-white border border-gray-200 p-10 text-center shadow-lg relative overflow-hidden flex flex-col items-center">
        {/* Glowing circular backdrop decoration matching Screenshot 6 */}
        <div className="absolute -inset-10 bg-radial-gradient from-red-500/5 via-transparent to-transparent opacity-50 pointer-events-none"></div>

        {/* Success Icon */}
        <div className="w-20 h-20 bg-red-50 text-brand-red rounded-full flex items-center justify-center mb-8 relative">
          <div className="absolute inset-0 bg-brand-red rounded-full opacity-10 animate-ping-slow"></div>
          <CheckCircle2 className="w-10 h-10 text-brand-red stroke-[2]" />
        </div>

        {/* Primary headers */}
        <h1 className="font-display text-4xl font-extrabold text-gray-900 tracking-tight mb-4">
          Network Synchronized
        </h1>
        <p className="text-gray-500 text-sm mb-8 leading-relaxed max-w-md mx-auto">
          Your supply chain data is now live and stored in the primary datastore of the network.
        </p>

        {/* Status Box matching Card on Screenshot 6 */}
        <div className="w-full bg-[#fcfcfc] border border-gray-150 p-5 mb-8 flex items-center text-left space-x-4">
          {/* Stacked cylinders (database icon) */}
          <div className="w-11 h-11 bg-white border border-gray-200 flex items-center justify-center text-gray-500 shadow-xs shrink-0">
            <Database className="w-5 h-5 text-gray-600" />
          </div>
          <div>
            <span className="font-mono text-[9px] uppercase tracking-widest text-gray-400 block font-semibold leading-none mb-1">
              INITIAL SYNC COMPLETE
            </span>
            <span className="font-mono text-sm font-bold text-gray-800 leading-none">
              {nodeCount} Nodes Connected • 0 Errors
            </span>
          </div>
        </div>

        {/* Red brand navigation action button */}
        <button
          onClick={onRestart}
          className="w-full bg-brand-red hover:bg-brand-red-hover active:bg-[#9c0a2b] text-white py-3.5 px-6 font-mono font-bold text-sm uppercase tracking-wide flex items-center justify-center space-x-2 transition-colors cursor-pointer"
        >
          <span>Proceed to Command Center</span>
          <ArrowRight className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  );
}
