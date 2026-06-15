import React, { useState } from 'react';
import { Database, FileSpreadsheet, FileText, ArrowRight } from 'lucide-react';
import { SourceType } from './types';

interface SourceSelectionProps {
  initialSource: SourceType;
  onSelect: (source: SourceType) => void;
  onContinue: () => void;
  onCancel: () => void;
}

export default function SourceSelection({
  initialSource,
  onSelect,
  onContinue,
  onCancel,
}: SourceSelectionProps) {
  const [selected, setSelected] = useState<SourceType>(initialSource);

  const handleSelect = (type: SourceType) => {
    setSelected(type);
    onSelect(type);
  };

  return (
    <div id="source-selection-container" className="h-screen bg-[#fafafa] flex flex-col font-sans text-gray-800 overflow-hidden">
      {/* Upper Brand / Progress Header */}
      <header id="source-header" className="bg-white border-b border-gray-100 py-4 px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/Praecantator.png" alt="Logo" className="w-8 h-8 object-contain" />
            <span className="font-headline text-xl font-bold text-red-500">Praecantator</span>
          </div>
          
          {/* Custom Step Tracker matching Screen 1 */}
          <div className="flex items-center space-x-12 relative w-full max-w-md">
            {/* Step 1 */}
            <div className="flex flex-col items-center flex-1 z-10">
              <span className="w-8 h-8 rounded-none bg-brand-red text-white flex items-center justify-center font-mono text-sm font-semibold mb-2">
                1
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-gray-900 font-bold">
                Source
              </span>
            </div>

            {/* Line 1 -> 2 */}
            <div className="absolute top-[15px] left-[15%] right-[55%] h-[2px] bg-brand-red"></div>

            {/* Step 2 */}
            <div className="flex flex-col items-center flex-1 z-10">
              <span className="w-8 h-8 rounded-none bg-gray-100 text-gray-400 border border-gray-200 flex items-center justify-center font-mono text-sm mb-2">
                2
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                Mapping
              </span>
            </div>

            {/* Line 2 -> 3 */}
            <div className="absolute top-[15px] left-[50%] right-[20%] h-[2px] bg-gray-200"></div>

            {/* Step 3 */}
            <div className="flex flex-col items-center flex-1 z-10">
              <span className="w-8 h-8 rounded-none bg-gray-100 text-gray-400 border border-gray-200 flex items-center justify-center font-mono text-sm mb-2">
                3
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                Success
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main id="source-main-content" className="flex-1 overflow-y-auto py-16 px-4 md:px-8 w-full flex flex-col justify-center items-center">
        <div className="text-center max-w-2xl mb-12">
          <h1 className="font-display text-4xl font-bold text-gray-900 mb-4 tracking-tight">
            Select Data Source
          </h1>
          <p className="text-gray-500 font-sans leading-relaxed text-base">
            Choose how you want to ingest your initial supply chain dataset. You can connect
            directly to an existing ERP or map a custom CSV export.
          </p>
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl items-stretch">
          {/* Card 1: Connect ERP */}
          <div
            id="card-source-erp"
            onClick={() => handleSelect('ERP')}
            className={`cursor-pointer rounded-none bg-white p-8 border transition-all flex flex-col justify-between h-full ${
              selected === 'ERP'
                ? 'border-black ring-1 ring-black shadow-md relative'
                : 'border-gray-200 hover:border-gray-300 hover:shadow-xs'
            }`}
          >
            <div>
              {/* Icon Container */}
              <div className="w-12 h-12 bg-gray-50 flex items-center justify-center mb-6 border border-gray-100 text-brand-red">
                <Database className="w-5 h-5" />
              </div>
              <h3 className="font-display text-xl font-bold text-gray-900 mb-3">
                Connect ERP
              </h3>
              <p className="text-gray-500 text-sm leading-relaxed mb-8 font-sans">
                Establish a direct, secure connection to your existing enterprise resource planning
                system for continuous synchronization.
              </p>
            </div>

            <div>
              <div className="border-t border-gray-100 pt-6">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 block mb-3 font-semibold">
                  SUPPORTED INTEGRATIONS
                </span>
                <div className="flex flex-wrap gap-2">
                  {['SAP', 'ORACLE', 'NETSUITE'].map((brand) => (
                    <span
                      key={brand}
                      className="bg-gray-100 text-gray-600 font-mono text-[10px] px-2.5 py-1 uppercase font-bold tracking-wider"
                    >
                      {brand}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Interactive CSV Mapper (Selected by default in Screenshot 1) */}
          <div
            id="card-source-csv"
            onClick={() => handleSelect('CSV')}
            className={`cursor-pointer rounded-none bg-white p-8 border transition-all flex flex-col justify-between h-full ${
              selected === 'CSV'
                ? 'border-black ring-1 ring-black shadow-md bg-zinc-50/20 relative'
                : 'border-gray-200 hover:border-gray-300 hover:shadow-xs'
            }`}
          >
            <div>
              {/* Icon Container */}
              <div className="w-12 h-12 bg-gray-50 flex items-center justify-center mb-6 border border-gray-100 text-brand-red">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h3 className="font-display text-xl font-bold text-gray-900 mb-3">
                Interactive CSV Mapper
              </h3>
              <p className="text-gray-500 text-sm leading-relaxed mb-8 font-sans">
                Upload a static flat file. Use our intelligent mapping tool to align your raw columns to
                the Praecantator data model.
              </p>
            </div>

            <div>
              <div className="border-t border-gray-100 pt-6">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 block mb-3 font-semibold">
                  REQUIREMENTS
                </span>
                <ul className="text-gray-600 text-sm font-sans space-y-1.5 pl-0 list-none font-medium">
                  <li className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full inline-block"></span>
                    <span>Valid .csv format</span>
                  </li>
                  <li className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full inline-block"></span>
                    <span>Max file size: 500MB</span>
                  </li>
                  <li className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full inline-block"></span>
                    <span>Header row required</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Card 3: Manual Node Entry */}
          <div
            id="card-source-manual"
            onClick={() => handleSelect('MANUAL')}
            className={`cursor-pointer rounded-none bg-white p-8 border transition-all flex flex-col justify-between h-full ${
              selected === 'MANUAL'
                ? 'border-black ring-1 ring-black shadow-md relative'
                : 'border-gray-200 hover:border-gray-300 hover:shadow-xs'
            }`}
          >
            <div>
              {/* Icon Container */}
              <div className="w-12 h-12 bg-gray-50 flex items-center justify-center mb-6 border border-gray-100 text-brand-red">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="font-display text-xl font-bold text-gray-900 mb-3">
                Manual Node Entry
              </h3>
              <p className="text-gray-500 text-sm leading-relaxed mb-8 font-sans">
                Manually add individual nodes and supply chain connections directly within the
                interface. Ideal for smaller networks or trial explorations.
              </p>
            </div>

            <div>
              <div className="border-t border-gray-100 pt-6">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 block mb-3 font-semibold">
                  BEST FOR
                </span>
                <ul className="text-gray-600 text-sm font-sans space-y-1.5 pl-0 list-none font-medium">
                  <li className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full inline-block"></span>
                    <span>Small networks</span>
                  </li>
                  <li className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full inline-block"></span>
                    <span>Trial explorations</span>
                  </li>
                  <li className="flex items-center space-x-1.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full inline-block"></span>
                    <span>Quick prototyping</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Navigation Bar */}
      <footer id="source-footer" className="shrink-0 bg-white border-t border-gray-100 py-6 px-8">
        <div className="w-full flex items-center justify-between">
          <button
            id="btn-source-cancel"
            onClick={onCancel}
            className="border border-black px-6 py-2.5 font-mono text-sm tracking-wide text-gray-900 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors"
          >
            Cancel
          </button>
          <button
            id="btn-source-continue"
            onClick={onContinue}
            className="bg-brand-red hover:bg-brand-red-hover active:bg-[#9c0a2b] text-white font-semibold font-mono text-sm px-8 py-2.5 flex items-center space-x-2 shadow-xs cursor-pointer transition-colors"
          >
            <span>Continue</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
}
