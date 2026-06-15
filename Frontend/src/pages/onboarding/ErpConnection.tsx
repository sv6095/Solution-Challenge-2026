import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, Lock, CheckCircle, Database, HelpCircle, Settings, Plus, Info } from 'lucide-react';
import { ERPConfig } from './types';

interface ErpConnectionProps {
  onBack: () => void;
  onContinue: (connectedErps: ERPConfig[]) => void;
}

export default function ErpConnection({ onBack, onContinue }: ErpConnectionProps) {
  const [erps, setErps] = useState<ERPConfig[]>([
    {
      id: 'sap',
      name: 'SAP S/4HANA',
      description: 'OData V4 API integration enabled. Syncing master data and financial records.',
      status: 'CONNECTED',
      endpointUrl: 'https://api.sap.example.com/v4/odata',
      logoType: 'sap',
    },
    {
      id: 'oracle',
      name: 'Oracle Cloud ERP',
      description: 'REST API connectivity for procurement and inventory management modules.',
      status: 'DISCONNECTED',
      logoType: 'oracle',
      apiKey: '',
    },
    {
      id: 'netsuite',
      name: 'Oracle NetSuite',
      description: 'SuiteTalk REST Web Services integration. Token-based authentication required.',
      status: 'DISCONNECTED',
      logoType: 'netsuite',
      tokenId: '',
    },
  ]);

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [customRequestShow, setCustomRequestShow] = useState(false);
  const [customRequestText, setCustomRequestText] = useState('');

  const handleConnect = (id: string) => {
    const erp = erps.find((e) => e.id === id);
    if (!erp) return;

    if (id === 'oracle' && !erp.apiKey?.trim()) {
      setErrorId(id);
      setTimeout(() => setErrorId(null), 3000);
      return;
    }
    if (id === 'netsuite' && !erp.tokenId?.trim()) {
      setErrorId(id);
      setTimeout(() => setErrorId(null), 3000);
      return;
    }

    setLoadingId(id);
    setErrorId(null);

    // Simulated short connecting delay
    setTimeout(() => {
      setErps((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: 'CONNECTED' as const }
            : item
        )
      );
      setLoadingId(null);
      setSuccessMsg(`Successfully established secure authenticated channel to ${erp.name}!`);
      setTimeout(() => setSuccessMsg(null), 4000);
    }, 1500);
  };

  const handleInputChange = (id: string, field: 'endpointUrl' | 'apiKey' | 'tokenId', value: string) => {
    setErps((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleDisconnect = (id: string) => {
    setErps((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: 'DISCONNECTED' as const, apiKey: '', tokenId: '' }
          : item
      )
    );
  };

  const handleSubmitCustomRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customRequestText.trim()) return;
    setSuccessMsg(`Request for custom ERP integration ('${customRequestText}') submitted!`);
    setCustomRequestText('');
    setCustomRequestShow(false);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const activeConnectedErps = erps.filter((e) => e.status === 'CONNECTED');

  const handleContinueClick = () => {
    onContinue(activeConnectedErps);
  };

  return (
    <div id="erp-connection-view" className="min-h-screen bg-[#fafafa] flex flex-col justify-between font-sans text-gray-800">
      {/* Top Header matching Screen 2 */}
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
                Step 2 of 4
              </span>
              <div className="flex space-x-1 items-center">
                <span className="w-6 h-1.5 bg-brand-red inline-block"></span>
                <span className="w-6 h-1.5 bg-brand-red inline-block"></span>
                <span className="w-6 h-1.5 bg-gray-100 inline-block"></span>
                <span className="w-6 h-1.5 bg-gray-100 inline-block"></span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 py-12 px-6 max-w-7xl mx-auto w-full flex flex-col justify-center">
        {/* Alerts / Success Notification Popup */}
        {successMsg && (
          <div className="mb-6 bg-emerald-50 border-l-4 border-emerald-500 p-4 text-emerald-800 flex items-center space-x-3 text-sm animate-fade-in shadow-xs">
            <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="mb-10 max-w-3xl">
          <h1 className="font-display text-3xl font-bold text-gray-900 mb-3 tracking-tight">
            Secure ERP Connection
          </h1>
          <p className="text-gray-500 leading-relaxed text-sm">
            Establish a direct link to your enterprise system for automated synchronization. Connections
            are secured via TLS 1.3 and require valid API credentials.
          </p>
        </div>

        {/* Integration Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch mb-10">
          {erps.map((erp) => {
            const isConnected = erp.status === 'CONNECTED';
            const isConnecting = loadingId === erp.id;
            const hasError = errorId === erp.id;

            return (
              <div
                key={erp.id}
                id={`card-config-${erp.id}`}
                className={`bg-white p-7 border flex flex-col justify-between h-full relative group transition-all ${
                  isConnected
                    ? 'border-emerald-200 shadow-xs'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {/* Upper region with Icon and Badge */}
                <div>
                  <div className="flex items-center justify-between mb-6">
                    {/* Brand-styled block icon placeholder */}
                    <div className="w-12 h-12 bg-gray-50 flex items-center justify-center border border-gray-100 text-gray-700">
                      {erp.logoType === 'sap' && (
                        <Database className="w-5 h-5 text-indigo-600" />
                      )}
                      {erp.logoType === 'oracle' && (
                        <div className="font-mono font-black text-xs text-red-600">ORCL</div>
                      )}
                      {erp.logoType === 'netsuite' && (
                        <div className="font-mono font-black text-xs text-blue-600">NS</div>
                      )}
                    </div>

                    {/* Badge */}
                    <span
                      className={`inline-flex items-center space-x-1.5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider font-bold ${
                        isConnected
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                          : 'bg-gray-100 text-gray-400 border border-gray-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isConnected ? 'bg-emerald-500' : 'bg-gray-400'
                        }`}
                      ></span>
                      <span>{erp.status}</span>
                    </span>
                  </div>

                  <h3 className="font-display text-xl font-bold text-gray-900 mb-2">
                    {erp.name}
                  </h3>
                  <p className="text-gray-400 text-xs leading-relaxed mb-6">
                    {erp.description}
                  </p>
                </div>

                {/* Connection Form Fields depending on state */}
                <div className="border-t border-gray-100 pt-5 mt-auto">
                  {erp.id === 'sap' ? (
                    <div>
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-2 font-semibold">
                        ENDPOINT URL
                      </label>
                      <div className="relative mb-4">
                        <input
                          type="text"
                          value={erp.endpointUrl || ''}
                          readOnly
                          className="w-full bg-gray-50 border border-gray-200 px-3 py-2 text-xs font-mono text-gray-600 focus:outline-none pr-8 cursor-not-allowed"
                        />
                        <Lock className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                      </div>
                      {isConnected ? (
                        <div className="flex space-x-2">
                          <button
                            id="btn-sap-configure-sync"
                            onClick={() => {
                              setSuccessMsg('SAP alignment sync settings modified.');
                              setTimeout(() => setSuccessMsg(null), 3000);
                            }}
                            className="flex-1 bg-gray-50 border border-gray-200 hover:border-gray-300 font-mono text-[10px] uppercase font-bold tracking-wider py-2.5 text-gray-700 text-center transition-colors cursor-pointer"
                          >
                            CONFIGURE SYNC
                          </button>
                          <button
                            id="btn-sap-disconnect"
                            onClick={() => handleDisconnect('sap')}
                            className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 font-mono text-[10px] uppercase font-bold tracking-wider px-3.5 py-2.5 transition-colors cursor-pointer"
                            title="Disconnect Connection"
                          >
                            Disconnect
                          </button>
                        </div>
                      ) : (
                        <button
                          id="btn-sap-reconnect"
                          onClick={() => {
                            setErps((prev) =>
                              prev.map((it) =>
                                it.id === 'sap' ? { ...it, status: 'CONNECTED' } : it
                              )
                            );
                            setSuccessMsg('SAP ERP secure connection re-established.');
                            setTimeout(() => setSuccessMsg(null), 3000);
                          }}
                          className="w-full bg-brand-red hover:bg-brand-red-hover text-white font-mono text-[10px] uppercase font-bold tracking-wider py-2.5 transition-colors cursor-pointer"
                        >
                          CONNECT &rarr;
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-2 font-semibold">
                        {erp.id === 'oracle' ? 'API KEY' : 'TOKEN ID'}
                      </label>
                      <input
                        type={isConnected ? 'password' : 'text'}
                        placeholder={isConnected ? '••••••••••••••••••••' : (erp.id === 'oracle' ? 'Enter API Key' : 'Enter Token ID')}
                        value={erp.id === 'oracle' ? erp.apiKey || '' : erp.tokenId || ''}
                        disabled={isConnected || isConnecting}
                        onChange={(e) =>
                          handleInputChange(
                            erp.id,
                            erp.id === 'oracle' ? 'apiKey' : 'tokenId',
                            e.target.value
                          )
                        }
                        className={`w-full border px-3 py-2 text-xs font-mono focus:outline-none mb-4 ${
                          hasError
                            ? 'border-red-500 bg-red-50/10 focus:border-red-500'
                            : isConnected
                            ? 'border-emerald-100 bg-emerald-50/5 text-emerald-800'
                            : 'border-gray-200 focus:border-gray-400'
                        }`}
                      />

                      {isConnected ? (
                        <button
                          onClick={() => handleDisconnect(erp.id)}
                          className="w-full bg-gray-50 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-gray-700 border border-gray-200 font-mono text-[10px] uppercase font-bold tracking-wider py-2.5 transition-all cursor-pointer"
                        >
                          Disconnect Connection
                        </button>
                      ) : (
                        <button
                          onClick={() => handleConnect(erp.id)}
                          disabled={isConnecting}
                          className="w-full bg-brand-red hover:bg-brand-red-hover active:bg-[#9c0a2b] disabled:bg-gray-200 text-white font-mono text-[10px] uppercase font-bold tracking-wider py-2.5 flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                        >
                          {isConnecting ? (
                            <>
                              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                              <span>SECURELY SIGNING...</span>
                            </>
                          ) : (
                            <span>CONNECT &rarr;</span>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom Request Action */}
        <div className="flex flex-col items-center">
          {!customRequestShow ? (
            <button
              onClick={() => setCustomRequestShow(true)}
              className="text-gray-500 hover:text-black font-mono text-xs tracking-wide flex items-center space-x-1 border border-dashed border-gray-300 hover:border-gray-500 px-5 py-2.5 bg-white transition-all cursor-pointer"
            >
              <Plus className="w-4.5 h-4.5 text-brand-red" />
              <span>+ Request custom ERP integration</span>
            </button>
          ) : (
            <form
              onSubmit={handleSubmitCustomRequest}
              className="w-full max-w-md bg-white border border-gray-200 p-6 animate-fade-in shadow-xs"
            >
              <h4 className="font-display font-bold text-sm text-gray-900 mb-2">
                Submit Integration Proposal
              </h4>
              <p className="text-gray-400 text-xs mb-4">
                Let our systems architecture group engineer custom middleware connectors for your stack.
              </p>
              <input
                type="text"
                placeholder="e.g. Microsoft Dynamics 365, Epicor..."
                value={customRequestText}
                onChange={(e) => setCustomRequestText(e.target.value)}
                required
                className="w-full border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:border-brand-red mb-3 font-sans"
              />
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setCustomRequestShow(false)}
                  className="px-4 py-2 text-xs font-mono border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-mono bg-brand-red hover:bg-brand-red-hover text-white cursor-pointer"
                >
                  Submit Request
                </button>
              </div>
            </form>
          )}
        </div>
      </main>

      {/* Footer conforming to Screen 2 layout */}
      <footer className="bg-white border-t-2 border-black py-4 px-8 mt-12 bg-zinc-50/30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-mono text-[10px] text-gray-400">
            © 2026 Praecantator Enterprise Systems. All rights reserved.
          </span>
          <div className="flex space-x-3">
            <button
              onClick={onBack}
              className="border border-black px-6 py-2 bg-white hover:bg-gray-50 active:bg-gray-100 font-mono text-xs font-bold tracking-wider text-gray-900 transition-colors uppercase cursor-pointer"
            >
              BACK
            </button>
            <button
              onClick={() => {
                setSuccessMsg('Configurations successfully backed up to browser local draft.');
                setTimeout(() => setSuccessMsg(null), 3000);
              }}
              className="border border-gray-200 px-6 py-2 bg-white hover:bg-gray-50 font-mono text-xs font-bold tracking-wider text-gray-500 hover:text-gray-900 transition-colors uppercase cursor-pointer"
            >
              SAVE DRAFT
            </button>
            <button
              onClick={handleContinueClick}
              className="bg-neutral-900 hover:bg-black active:bg-neutral-800 text-white px-8 py-2 font-mono text-xs font-bold tracking-wider transition-colors uppercase inline-flex items-center space-x-1.5 cursor-pointer"
            >
              <span>CONTINUE</span>
              <span>&gt;</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
