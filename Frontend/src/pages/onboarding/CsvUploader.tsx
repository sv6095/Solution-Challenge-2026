import React, { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowLeft, ArrowRight, Table, Database, Network } from 'lucide-react';

interface CsvUploaderProps {
  onBack: () => void;
  onFileUploaded: (suppliersName: string, nodesName: string) => void;
}

export default function CsvUploader({ onBack, onFileUploaded }: CsvUploaderProps) {
  // Dual file states
  const [suppliersFile, setSuppliersFile] = useState<{ name: string; size: string } | null>(null);
  const [nodesFile, setNodesFile] = useState<{ name: string; size: string } | null>(null);

  const [activeSlot, setActiveSlot] = useState<'suppliers' | 'nodes' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const suppliersInputRef = useRef<HTMLInputElement>(null);
  const nodesInputRef = useRef<HTMLInputElement>(null);

  // Exact fields matching user uploader images
  const defaultSuppliersFields = [
    { name: 'supplier_n', type: 'string' },
    { name: 'country', type: 'string' },
    { name: 'email', type: 'string' },
    { name: 'products_categories', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'tier', type: 'string' },
    { name: 'origin_nodes', type: 'string' },
    { name: 'sla_days', type: 'integer' },
    { name: 'incoterm', type: 'string' },
    { name: 'backup_supplier', type: 'boolean' },
  ];

  const defaultNodesFields = [
    { name: 'node_name', type: 'string' },
    { name: 'address', type: 'string' },
    { name: 'node_type', type: 'string' },
  ];

  const processFile = (type: 'suppliers' | 'nodes', fileName: string, fileSize: number) => {
    if (!fileName.toLowerCase().endsWith('.csv')) {
      setError(`Invalid file type for ${type === 'suppliers' ? 'Suppliers' : 'Nodes'} upload. Please upload a structured .csv file.`);
      return;
    }
    setError(null);
    setIsProcessing(true);

    const fileMeta = {
      name: fileName,
      size: (fileSize / 1024).toFixed(2) + ' KB',
    };

    setTimeout(() => {
      if (type === 'suppliers') {
        setSuppliersFile(fileMeta);
      } else {
        setNodesFile(fileMeta);
      }
      setIsProcessing(false);
    }, 1000);
  };

  const handleFileSelect = (type: 'suppliers' | 'nodes', e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      processFile(type, selectedFile.name, selectedFile.size);
    }
  };

  const loadDefaultMockTemplates = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setSuppliersFile({
        name: 'suppliers_v2.csv',
        size: '1.84 KB',
      });
      setNodesFile({
        name: 'nodes_v2.csv',
        size: '0.94 KB',
      });
      setIsProcessing(false);
      setError(null);
    }, 800);
  };

  const clearFile = (type: 'suppliers' | 'nodes', e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === 'suppliers') {
      setSuppliersFile(null);
    } else {
      setNodesFile(null);
    }
  };

  const handleContinue = () => {
    if (!suppliersFile || !nodesFile) {
      setError('Please provide BOTH a Suppliers CSV and an Infrastructure Nodes CSV to proceed with complete supply chain mapping.');
      return;
    }
    onFileUploaded(suppliersFile.name, nodesFile.name);
  };

  return (
    <div id="csv-uploader-view" className="min-h-screen bg-[#fafafa] flex flex-col justify-between font-sans text-gray-800">
      {/* Header bar matching corporate layout */}
      <header className="bg-white border-b border-gray-100 py-4 px-8 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center gap-3 mr-2">
              <img src="/Praecantator.png" alt="Logo" className="w-8 h-8 object-contain" />
              <span className="font-headline text-xl font-bold text-red-500">Praecantator</span>
            </div>
            <div className="h-4 w-[1px] bg-gray-200"></div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs text-gray-400 font-semibold uppercase tracking-wider">
                Step 2 of 3
              </span>
              <div className="flex space-x-1 items-center">
                <span className="w-6 h-1.5 bg-brand-red inline-block"></span>
                <span className="w-6 h-1.5 bg-brand-red inline-block"></span>
                <span className="w-6 h-1.5 bg-gray-100 inline-block"></span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-12 px-6 max-w-6xl mx-auto w-full flex flex-col justify-center">
        <div className="mb-10 text-center">
          <h1 className="font-display text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
            Ingest Supply Chain Databases
          </h1>
          <p className="text-gray-500 text-sm max-w-2xl mx-auto">
            To build a resilient relational network, provide separate data tables for your <strong className="text-gray-700 font-semibold">External Suppliers</strong> and physical <strong className="text-gray-700 font-semibold">Logistics Nodes</strong>. This eliminates flat-file redundancy and ensures proper geocoding mapping.
          </p>

          <div className="mt-5">
            <button
              id="btn-load-templates"
              type="button"
              className="bg-brand-red/5 hover:bg-brand-red/10 text-brand-red border border-brand-red/20 font-mono text-xs px-5 py-2.5 font-bold uppercase tracking-wider transition-colors inline-flex items-center space-x-2 cursor-pointer"
              onClick={loadDefaultMockTemplates}
            >
              <Network className="w-4 h-4" />
              <span>Use Default Supplier & Nodes</span>
            </button>
          </div>
        </div>

        {/* Dual Upload Zone Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Card 1: Suppliers CSV Drop Slot */}
          <div
            id="slot-suppliers"
            onClick={() => suppliersInputRef.current?.click()}
            className={`border-2 border-dashed rounded-none p-10 text-center cursor-pointer transition-all flex flex-col justify-between h-full bg-white relative ${
              suppliersFile
                ? 'border-emerald-400 bg-emerald-50/5'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              ref={suppliersInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => handleFileSelect('suppliers', e)}
              className="hidden"
            />

            <div className="flex flex-col items-center justify-center space-y-4">
              <span className="bg-red-50 text-brand-red font-mono text-[9px] uppercase tracking-wider font-extrabold px-2.5 py-0.5 border border-red-100">
                Data Set A
              </span>

              {suppliersFile ? (
                <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border border-emerald-100">
                  <CheckCircle className="w-7 h-7" />
                </div>
              ) : (
                <div className="w-14 h-14 bg-red-50 text-brand-red rounded-full flex items-center justify-center border border-red-100">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
              )}

              <div>
                <h3 className="font-display font-extrabold text-gray-900 text-base">
                  {suppliersFile ? suppliersFile.name : 'Suppliers & Partners CSV'}
                </h3>
                <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">
                  {suppliersFile
                    ? `File loaded successfully (${suppliersFile.size})`
                    : 'Mandatory directory detailing supplier tiers, SLA terms, product categories, and associated warehouse nodes.'}
                </p>
              </div>
            </div>

            {suppliersFile ? (
              <button
                onClick={(e) => clearFile('suppliers', e)}
                className="mt-6 text-xs font-mono text-gray-400 hover:text-red-500 transition-colors uppercase font-bold"
              >
                Clear file
              </button>
            ) : (
              <span className="mt-6 font-mono text-[10px] text-gray-400 uppercase font-semibold">
                Click or Drop to upload suppliers database
              </span>
            )}
          </div>

          {/* Card 2: Infrastructure Nodes Drop Slot */}
          <div
            id="slot-nodes"
            onClick={() => nodesInputRef.current?.click()}
            className={`border-2 border-dashed rounded-none p-10 text-center cursor-pointer transition-all flex flex-col justify-between h-full bg-white relative ${
              nodesFile
                ? 'border-emerald-400 bg-emerald-50/5'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              ref={nodesInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => handleFileSelect('nodes', e)}
              className="hidden"
            />

            <div className="flex flex-col items-center justify-center space-y-4">
              <span className="bg-slate-50 text-slate-500 font-mono text-[9px] uppercase tracking-wider font-extrabold px-2.5 py-0.5 border border-slate-150">
                Data Set B
              </span>

              {nodesFile ? (
                <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border border-emerald-100">
                  <CheckCircle className="w-7 h-7" />
                </div>
              ) : (
                <div className="w-14 h-14 bg-gray-50 text-gray-500 rounded-full flex items-center justify-center border border-gray-150">
                  <Database className="w-6 h-6" />
                </div>
              )}

              <div>
                <h3 className="font-display font-extrabold text-gray-900 text-base">
                  {nodesFile ? nodesFile.name : 'Physical Logistics Nodes CSV'}
                </h3>
                <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">
                  {nodesFile
                    ? `File loaded successfully (${nodesFile.size})`
                    : 'Mandatory registry detailing factory names, street addresses, and facility types for geo-mapping resolution.'}
                </p>
              </div>
            </div>

            {nodesFile ? (
              <button
                onClick={(e) => clearFile('nodes', e)}
                className="mt-6 text-xs font-mono text-gray-400 hover:text-red-500 transition-colors uppercase font-bold"
              >
                Clear file
              </button>
            ) : (
              <span className="mt-6 font-mono text-[10px] text-gray-400 uppercase font-semibold">
                Click or Drop to upload logistics nodes database
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 p-4 mb-6 text-red-700 flex items-start space-x-3 text-sm">
            <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isProcessing && (
          <div className="bg-white border border-gray-200 p-8 flex flex-col items-center justify-center py-6 text-gray-500 text-sm">
            <div className="w-8 h-8 border-2 border-brand-red border-t-transparent rounded-full animate-spin mb-3"></div>
            <span className="font-mono text-xs uppercase tracking-widest font-bold text-gray-800">Processing Databases</span>
            <span className="text-gray-400 text-xs mt-1">Inspecting column matrices and resolving relational references...</span>
          </div>
        )}

        {/* Dual Previews Section */}
        {!isProcessing && (suppliersFile || nodesFile) && (
          <div className="space-y-6 mt-6">
            <div className="border border-gray-200 bg-white p-6">
              <h3 className="font-display font-bold text-gray-900 text-sm mb-4 border-b border-gray-100 pb-2 flex items-center space-x-2">
                <Table className="w-4 h-4 text-brand-red animate-pulse" />
                <span>Relationship Schema Registry Preview</span>
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Suppliers Schema Preview */}
                <div className="opacity-95">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[10px] font-extrabold uppercase tracking-widest text-[#db1d49]">
                      {suppliersFile ? suppliersFile.name : 'Suppliers File (Awaiting Upload)'}
                    </span>
                    <span className="text-[10px] bg-gray-100 px-2 py-0.5 font-mono text-gray-500 font-bold uppercase">suppliers.csv</span>
                  </div>

                  {suppliersFile ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5 border border-gray-150 p-3 bg-zinc-50/50">
                        {defaultSuppliersFields.map((f, i) => (
                          <div key={i} className="bg-white border border-gray-200 px-2 py-1 text-center font-mono text-[9px]">
                            <span className="text-gray-900 font-bold block truncate">{f.name}</span>
                            <span className="text-gray-400 block tracking-wide uppercase text-[7px] font-semibold">{f.type}</span>
                          </div>
                        ))}
                      </div>

                      {/* Simple sample row layout */}
                      <div className="overflow-x-auto text-[11px] font-sans">
                        <table className="w-full text-left whitespace-nowrap border-collapse">
                          <thead>
                            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-500 font-mono text-[9px] uppercase tracking-wider">
                              <th className="p-2 font-bold">supplier_n</th>
                              <th className="p-2 font-bold">country</th>
                              <th className="p-2 font-bold">email</th>
                              <th className="p-2 font-bold">origin_nodes</th>
                              <th className="p-2 font-bold">sla_days</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-neutral-700">
                            <tr>
                              <td className="p-2 font-semibold">Supplier_1</td>
                              <td className="p-2">UAE</td>
                              <td className="p-2 text-gray-500">supplier1@example.com</td>
                              <td className="p-2 font-mono">Node_165</td>
                              <td className="p-2 font-mono text-emerald-600 font-bold">15 days</td>
                            </tr>
                            <tr>
                              <td className="p-2 font-semibold">Supplier_2</td>
                              <td className="p-2">Canada</td>
                              <td className="p-2 text-gray-500">supplier2@example.com</td>
                              <td className="p-2 font-mono">Node_98</td>
                              <td className="p-2 font-mono text-emerald-600 font-bold">12 days</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-gray-200 rounded p-6 text-center text-xs text-gray-400 font-mono bg-zinc-50/20">
                      Upload Suppliers CSV file to view structure schema
                    </div>
                  )}
                </div>

                {/* Nodes Schema Preview */}
                <div className="opacity-95">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[10px] font-extrabold uppercase tracking-widest text-[#db1d49]">
                      {nodesFile ? nodesFile.name : 'Infrastructure File (Awaiting Upload)'}
                    </span>
                    <span className="text-[10px] bg-gray-100 px-2 py-0.5 font-mono text-gray-500 font-bold uppercase">nodes.csv</span>
                  </div>

                  {nodesFile ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5 border border-gray-150 p-3 bg-zinc-50/50">
                        {defaultNodesFields.map((f, i) => (
                          <div key={i} className="bg-white border border-gray-200 px-2 py-1 text-center font-mono text-[9px] min-w-[70px]">
                            <span className="text-gray-900 font-bold block truncate">{f.name}</span>
                            <span className="text-gray-400 block tracking-wide uppercase text-[7px] font-semibold">{f.type}</span>
                          </div>
                        ))}
                      </div>

                      {/* Raw table preview */}
                      <div className="overflow-x-auto text-[11px] font-sans">
                        <table className="w-full text-left whitespace-nowrap border-collapse">
                          <thead>
                            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-500 font-mono text-[9px] uppercase tracking-wider">
                              <th className="p-2 font-bold">node_name</th>
                              <th className="p-2 font-bold">address</th>
                              <th className="p-2 font-bold">node_type</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-neutral-700">
                            <tr>
                              <td className="p-2 font-semibold">Factory A</td>
                              <td className="p-4 text-gray-500 py-1.5">Chennai India</td>
                              <td className="p-2"><span className="bg-slate-100 text-slate-800 text-[9px] font-mono font-bold px-1.5 py-0.5">factory</span></td>
                            </tr>
                            <tr>
                              <td className="p-2 font-semibold">Warehouse 1</td>
                              <td className="p-4 text-gray-500 py-1.5">Mumbai India</td>
                              <td className="p-2"><span className="bg-slate-100 text-slate-800 text-[9px] font-mono font-bold px-1.5 py-0.5">warehouse</span></td>
                            </tr>
                            <tr>
                              <td className="p-2 font-semibold">Port Hub</td>
                              <td className="p-4 text-gray-500 py-1.5">Nhava Sheva Port</td>
                              <td className="p-2"><span className="bg-slate-100 text-slate-800 text-[9px] font-mono font-bold px-1.5 py-0.5">port</span></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-gray-200 rounded p-6 text-center text-xs text-gray-400 font-mono bg-zinc-50/20">
                      Upload Logistics Nodes CSV file to view structure schema
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-100 py-6 px-8 sticky bottom-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <button
            id="btn-csv-back"
            onClick={onBack}
            className="border border-gray-300 hover:border-gray-400 text-gray-700 font-mono text-sm px-6 py-2.5 flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <button
            id="btn-csv-next"
            disabled={!suppliersFile || !nodesFile || isProcessing}
            onClick={handleContinue}
            className={`font-semibold font-mono text-sm px-8 py-2.5 flex items-center space-x-2 transition-all cursor-pointer ${
              suppliersFile && nodesFile && !isProcessing
                ? 'bg-brand-red hover:bg-[#db1d49]/90 text-white shadow-sm'
                : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
            }`}
          >
            <span>Automate Mapping & Ingest</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </footer>
    </div>
  );
}
