import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowLeft, ArrowRight, Table, Database, Network } from 'lucide-react';

export interface ParsedCsvData {
  file: File;
  headers: string[];
  rows: Record<string, string>[];
}

interface CsvUploaderProps {
  onBack: () => void;
  onFileUploaded: (suppliersData: ParsedCsvData, nodesData: ParsedCsvData) => void;
}

function formatSize(bytes: number): string {
  return (bytes / 1024).toFixed(2) + ' KB';
}

/** Parse a File with PapaParse and return headers + first N rows. */
function parseCsv(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        resolve({ headers, rows: results.data as Record<string, string>[] });
      },
      error: (err) => reject(err),
    });
  });
}

export default function CsvUploader({ onBack, onFileUploaded }: CsvUploaderProps) {
  const [suppliersData, setSuppliersData] = useState<ParsedCsvData | null>(null);
  const [nodesData, setNodesData] = useState<ParsedCsvData | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<'suppliers' | 'nodes' | null>(null);

  const suppliersInputRef = useRef<HTMLInputElement>(null);
  const nodesInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (type: 'suppliers' | 'nodes', file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError(`Invalid file type for ${type === 'suppliers' ? 'Suppliers' : 'Nodes'} upload. Please upload a .csv file.`);
      return;
    }
    setError(null);
    setIsProcessing(type);
    try {
      const { headers, rows } = await parseCsv(file);
      if (headers.length === 0) {
        setError(`The ${type} CSV appears to be empty or has no header row.`);
        setIsProcessing(null);
        return;
      }
      const parsed: ParsedCsvData = { file, headers, rows };
      if (type === 'suppliers') {
        setSuppliersData(parsed);
      } else {
        setNodesData(parsed);
      }
    } catch {
      setError(`Failed to parse the ${type} CSV. Please ensure it is a valid UTF-8 encoded file.`);
    } finally {
      setIsProcessing(null);
    }
  };

  const handleFileSelect = (type: 'suppliers' | 'nodes', e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      processFile(type, e.target.files[0]);
      // Reset so the same file can be re-selected
      e.target.value = '';
    }
  };

  const clearFile = (type: 'suppliers' | 'nodes', e: React.MouseEvent) => {
    e.stopPropagation();
    if (type === 'suppliers') {
      setSuppliersData(null);
    } else {
      setNodesData(null);
    }
  };

  const handleContinue = () => {
    if (!suppliersData || !nodesData) {
      setError('Please provide BOTH a Suppliers CSV and an Infrastructure Nodes CSV to proceed.');
      return;
    }
    onFileUploaded(suppliersData, nodesData);
  };

  const busy = isProcessing !== null;

  return (
    <div id="csv-uploader-view" className="min-h-screen bg-[#fafafa] flex flex-col justify-between font-sans text-gray-800">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 py-4 px-8 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center gap-3 mr-2">
              <img src="/Praecantator.png" alt="Logo" className="w-8 h-8 object-contain" />
              <span className="font-headline text-xl font-bold text-red-500">Praecantator</span>
            </div>
            <div className="h-4 w-[1px] bg-gray-200" />
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs text-gray-400 font-semibold uppercase tracking-wider">
                Step 2 of 3
              </span>
              <div className="flex space-x-1 items-center">
                <span className="w-6 h-1.5 bg-brand-red inline-block" />
                <span className="w-6 h-1.5 bg-brand-red inline-block" />
                <span className="w-6 h-1.5 bg-gray-100 inline-block" />
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
            Upload your <strong className="text-gray-700 font-semibold">Suppliers CSV</strong> and{' '}
            <strong className="text-gray-700 font-semibold">Logistics Nodes CSV</strong>. Your actual data will be read, parsed, and sent to the backend.
          </p>
        </div>

        {/* Upload Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Suppliers Slot */}
          <div
            id="slot-suppliers"
            onClick={() => !busy && suppliersInputRef.current?.click()}
            className={`border-2 border-dashed rounded-none p-10 text-center cursor-pointer transition-all flex flex-col justify-between h-full bg-white relative ${
              suppliersData
                ? 'border-emerald-400 bg-emerald-50/5'
                : 'border-gray-200 hover:border-gray-300'
            } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
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
              {isProcessing === 'suppliers' ? (
                <div className="w-14 h-14 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-brand-red border-t-transparent rounded-full animate-spin" />
                </div>
              ) : suppliersData ? (
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
                  {suppliersData ? suppliersData.file.name : 'Suppliers & Partners CSV'}
                </h3>
                <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">
                  {suppliersData
                    ? `Parsed ${suppliersData.rows.length} rows · ${formatSize(suppliersData.file.size)}`
                    : 'Upload your suppliers directory: tiers, SLA, product categories, and node references.'}
                </p>
              </div>
            </div>
            {suppliersData ? (
              <button
                onClick={(e) => clearFile('suppliers', e)}
                className="mt-6 text-xs font-mono text-gray-400 hover:text-red-500 transition-colors uppercase font-bold"
              >
                Clear file
              </button>
            ) : (
              <span className="mt-6 font-mono text-[10px] text-gray-400 uppercase font-semibold flex items-center justify-center gap-1">
                <Upload className="w-3 h-3" /> Click or drop to upload
              </span>
            )}
          </div>

          {/* Nodes Slot */}
          <div
            id="slot-nodes"
            onClick={() => !busy && nodesInputRef.current?.click()}
            className={`border-2 border-dashed rounded-none p-10 text-center cursor-pointer transition-all flex flex-col justify-between h-full bg-white relative ${
              nodesData
                ? 'border-emerald-400 bg-emerald-50/5'
                : 'border-gray-200 hover:border-gray-300'
            } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <input
              ref={nodesInputRef}
              type="file"
              accept=".csv"
              onChange={(e) => handleFileSelect('nodes', e)}
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center space-y-4">
              <span className="bg-slate-50 text-slate-500 font-mono text-[9px] uppercase tracking-wider font-extrabold px-2.5 py-0.5 border border-slate-200">
                Data Set B
              </span>
              {isProcessing === 'nodes' ? (
                <div className="w-14 h-14 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : nodesData ? (
                <div className="w-14 h-14 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center border border-emerald-100">
                  <CheckCircle className="w-7 h-7" />
                </div>
              ) : (
                <div className="w-14 h-14 bg-gray-50 text-gray-500 rounded-full flex items-center justify-center border border-gray-200">
                  <Database className="w-6 h-6" />
                </div>
              )}
              <div>
                <h3 className="font-display font-extrabold text-gray-900 text-base">
                  {nodesData ? nodesData.file.name : 'Physical Logistics Nodes CSV'}
                </h3>
                <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">
                  {nodesData
                    ? `Parsed ${nodesData.rows.length} rows · ${formatSize(nodesData.file.size)}`
                    : 'Factory names, addresses, node types, and geo-coordinates for map resolution.'}
                </p>
              </div>
            </div>
            {nodesData ? (
              <button
                onClick={(e) => clearFile('nodes', e)}
                className="mt-6 text-xs font-mono text-gray-400 hover:text-red-500 transition-colors uppercase font-bold"
              >
                Clear file
              </button>
            ) : (
              <span className="mt-6 font-mono text-[10px] text-gray-400 uppercase font-semibold flex items-center justify-center gap-1">
                <Upload className="w-3 h-3" /> Click or drop to upload
              </span>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 p-4 mb-6 text-red-700 flex items-start space-x-3 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Live Schema Preview */}
        {(suppliersData || nodesData) && (
          <div className="space-y-6 mt-4">
            <div className="border border-gray-200 bg-white p-6">
              <h3 className="font-display font-bold text-gray-900 text-sm mb-4 border-b border-gray-100 pb-2 flex items-center space-x-2">
                <Table className="w-4 h-4 text-brand-red" />
                <span>Parsed Schema — Live Preview</span>
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Suppliers Preview */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[10px] font-extrabold uppercase tracking-widest text-[#db1d49]">
                      {suppliersData ? suppliersData.file.name : 'Suppliers File (Awaiting Upload)'}
                    </span>
                    <span className="text-[10px] bg-gray-100 px-2 py-0.5 font-mono text-gray-500 font-bold uppercase">
                      suppliers.csv
                    </span>
                  </div>
                  {suppliersData ? (
                    <div className="space-y-3">
                      {/* Headers */}
                      <div className="flex flex-wrap gap-1.5 border border-gray-100 p-3 bg-zinc-50/50">
                        {suppliersData.headers.map((h, i) => (
                          <div key={i} className="bg-white border border-gray-200 px-2 py-1 text-center font-mono text-[9px]">
                            <span className="text-gray-900 font-bold block truncate max-w-[80px]">{h}</span>
                            <span className="text-gray-400 block tracking-wide uppercase text-[7px] font-semibold">string</span>
                          </div>
                        ))}
                      </div>
                      {/* First 3 rows */}
                      <div className="overflow-x-auto text-[11px]">
                        <table className="w-full text-left whitespace-nowrap border-collapse">
                          <thead>
                            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-500 font-mono text-[9px] uppercase tracking-wider">
                              {suppliersData.headers.slice(0, 5).map((h) => (
                                <th key={h} className="p-2 font-bold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-neutral-700">
                            {suppliersData.rows.slice(0, 3).map((row, i) => (
                              <tr key={i}>
                                {suppliersData.headers.slice(0, 5).map((h) => (
                                  <td key={h} className="p-2 truncate max-w-[120px]">{row[h] ?? ''}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-1 font-mono text-[9px] text-gray-400">{suppliersData.rows.length} total rows detected</p>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-gray-200 rounded p-6 text-center text-xs text-gray-400 font-mono bg-zinc-50/20">
                      Upload Suppliers CSV to preview schema
                    </div>
                  )}
                </div>

                {/* Nodes Preview */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-[10px] font-extrabold uppercase tracking-widest text-[#db1d49]">
                      {nodesData ? nodesData.file.name : 'Infrastructure File (Awaiting Upload)'}
                    </span>
                    <span className="text-[10px] bg-gray-100 px-2 py-0.5 font-mono text-gray-500 font-bold uppercase">
                      nodes.csv
                    </span>
                  </div>
                  {nodesData ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-1.5 border border-gray-100 p-3 bg-zinc-50/50">
                        {nodesData.headers.map((h, i) => (
                          <div key={i} className="bg-white border border-gray-200 px-2 py-1 text-center font-mono text-[9px]">
                            <span className="text-gray-900 font-bold block truncate max-w-[80px]">{h}</span>
                            <span className="text-gray-400 block tracking-wide uppercase text-[7px] font-semibold">string</span>
                          </div>
                        ))}
                      </div>
                      <div className="overflow-x-auto text-[11px]">
                        <table className="w-full text-left whitespace-nowrap border-collapse">
                          <thead>
                            <tr className="bg-gray-100/70 border-b border-gray-200 text-gray-500 font-mono text-[9px] uppercase tracking-wider">
                              {nodesData.headers.slice(0, 5).map((h) => (
                                <th key={h} className="p-2 font-bold">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-neutral-700">
                            {nodesData.rows.slice(0, 3).map((row, i) => (
                              <tr key={i}>
                                {nodesData.headers.slice(0, 5).map((h) => (
                                  <td key={h} className="p-2 truncate max-w-[120px]">{row[h] ?? ''}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-1 font-mono text-[9px] text-gray-400">{nodesData.rows.length} total rows detected</p>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-dashed border-gray-200 rounded p-6 text-center text-xs text-gray-400 font-mono bg-zinc-50/20">
                      Upload Logistics Nodes CSV to preview schema
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
            disabled={!suppliersData || !nodesData || busy}
            onClick={handleContinue}
            className={`font-semibold font-mono text-sm px-8 py-2.5 flex items-center space-x-2 transition-all cursor-pointer ${
              suppliersData && nodesData && !busy
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
