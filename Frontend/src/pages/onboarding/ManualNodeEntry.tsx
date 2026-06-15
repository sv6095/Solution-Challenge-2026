import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, MapPin, AlertCircle, CheckCircle, HelpCircle, Settings, Map } from 'lucide-react';
import { NodeItem } from './types';

interface ManualNodeEntryProps {
  onBack: () => void;
  onContinue: (nodes: NodeItem[]) => void;
}

export default function ManualNodeEntry({ onBack, onContinue }: ManualNodeEntryProps) {
  const [nodes, setNodes] = useState<NodeItem[]>([]);

  // Form Fields
  const [entityName, setEntityName] = useState('');
  const [address, setAddress] = useState('');
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);
  const [lastSelectedAddress, setLastSelectedAddress] = useState<string | null>(null);
  const [tier, setTier] = useState<'' | 'Tier 1' | 'Tier 2' | 'Tier 3'>('');

  // Suggestions state
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Status alerts
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto coordinate helper templates
  const coordinatePresets = [
    { name: 'Sydney Dispatch', lat: -33.8688, lng: 151.2093, address: 'Sydney NSW, Australia', tier: 'Tier 1' as const },
    { name: 'New York Port', lat: 40.7128, lng: -74.006, address: 'New York, NY, USA', tier: 'Tier 1' as const },
    { name: 'London Station', lat: 51.5074, lng: -0.1278, address: 'London, UK', tier: 'Tier 2' as const },
    { name: 'Johannesburg Relay', lat: -26.2041, lng: 28.0473, address: 'Johannesburg, South Africa', tier: 'Tier 3' as const },
  ];

  const applyPreset = (preset: typeof coordinatePresets[0]) => {
    setEntityName(preset.name);
    setAddress(preset.address);
    setLastSelectedAddress(preset.address);
    setSelectedLat(preset.lat);
    setSelectedLng(preset.lng);
    setTier(preset.tier);
    setFormError(null);
    setIsDropdownOpen(false);
    setSuggestions([]);
  };

  // Fetch Geocoding suggestions from Geoapify
  useEffect(() => {
    if (!address || address.trim().length < 3 || address === lastSelectedAddress) {
      setSuggestions([]);
      setIsDropdownOpen(false);
      return;
    }

    const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY || '';
    if (!apiKey) {
      console.warn("VITE_GEOAPIFY_API_KEY is not defined in the environment.");
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const response = await fetch(
          `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(address)}&limit=5&format=json&apiKey=${apiKey}`
        );
        if (response.ok) {
          const data = await response.json();
          if (data && data.results) {
            setSuggestions(data.results);
            setIsDropdownOpen(true);
          } else {
            setSuggestions([]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch autocomplete suggestions", err);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [address, lastSelectedAddress]);

  // Click outside listener for dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleAddressChange = (val: string) => {
    setAddress(val);
    setFormError(null);
    if (val !== lastSelectedAddress) {
      setSelectedLat(null);
      setSelectedLng(null);
    }
  };

  const handleSelectSuggestion = (suggestion: any) => {
    const formattedAddr = suggestion.formatted || '';
    setAddress(formattedAddr);
    setLastSelectedAddress(formattedAddr);
    setSelectedLat(suggestion.lat);
    setSelectedLng(suggestion.lon); // Map response 'lon' to 'lng'
    setIsDropdownOpen(false);
    setSuggestions([]);
  };

  const handleAddNode = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!entityName.trim()) {
      setFormError('Please provide an entity identifier name.');
      return;
    }

    if (selectedLat === null || selectedLng === null) {
      setFormError('Please enter a valid address and select it from the suggestions dropdown.');
      return;
    }

    if (!tier) {
      setFormError('Please select a Structural Hierarchy Tier level.');
      return;
    }

    // Node is valid, add it
    const newNode: NodeItem = {
      id: `manual-node-${Date.now()}`,
      name: entityName.trim(),
      lat: selectedLat,
      lng: selectedLng,
      tier: tier,
      address: address.trim(),
    };

    setNodes((prev) => [...prev, newNode]);
    setSuccessMsg(`"${newNode.name}" added to Staging Successfully!`);

    // Reset Form Fields
    setEntityName('');
    setAddress('');
    setSelectedLat(null);
    setSelectedLng(null);
    setLastSelectedAddress(null);
    setTier('');

    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleDeleteNode = (id: string, name: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setSuccessMsg(`Removed "${name}" from staged network.`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleContinueClick = () => {
    onContinue(nodes);
  };

  return (
    <div id="manual-entry-view" className="min-h-screen bg-[#fafafa] flex flex-col justify-between font-sans text-gray-800">
      {/* Header bar matching step indicator layout on Screen 3 */}
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

      {/* Main Panel Content Grid */}
      <main className="flex-1 py-10 px-6 max-w-7xl mx-auto w-full flex flex-col justify-center">
        {successMsg && (
          <div className="mb-6 bg-emerald-50 border-l-4 border-emerald-500 p-4 text-emerald-800 flex items-center space-x-3 text-sm animate-fade-in shadow-xs">
            <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-gray-900 mb-2 tracking-tight">
            Manual Node Entry
          </h1>
          <p className="text-gray-500 leading-relaxed text-sm">
            Define precise geospatial coordinates and structural hierarchy for manual routing ingestion.
          </p>
        </div>

        {/* Dynamic Dual Grid Column matching Screen 3 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Added Nodes List (Span 4) */}
          <div className="lg:col-span-5 bg-white border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
              <h3 className="font-display font-bold text-gray-900 text-lg">
                Added Nodes
              </h3>
              <span className="bg-gray-100 text-gray-600 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider font-bold">
                {nodes.length} STAGED
              </span>
            </div>

            {nodes.length === 0 ? (
              <div className="text-center py-12 px-4 border border-dashed border-gray-200">
                <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-400 font-sans">
                  No nodes registered yet. Complete the definition container on the right to stage records.
                </p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
                {nodes.map((node) => (
                  <div
                    key={node.id}
                    className="p-4 border border-gray-100 bg-[#fafafa] relative hover:border-gray-300 group transition-all"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 rounded-full bg-brand-red"></span>
                          <h4 className="font-mono font-bold text-xs text-gray-900 uppercase tracking-tight">
                            {node.name}
                          </h4>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mt-2 font-mono text-[10px] text-gray-400">
                          <div>
                            <span className="font-semibold block uppercase tracking-wide">LAT:</span>
                            <span className="text-gray-600 block mt-0.5">{node.lat?.toFixed(4) ?? 'N/A'}</span>
                          </div>
                          <div>
                            <span className="font-semibold block uppercase tracking-wide">LNG:</span>
                            <span className="text-gray-600 block mt-0.5">{node.lng?.toFixed(4) ?? 'N/A'}</span>
                          </div>
                        </div>
                        {node.address && (
                          <div className="mt-2 text-[10px] text-gray-500 font-sans border-t border-gray-100 pt-1.5 line-clamp-1" title={node.address}>
                            <span className="font-semibold text-[9px] text-gray-400 block font-mono uppercase">ADDRESS:</span>
                            {node.address}
                          </div>
                        )}
                        <div className="mt-3">
                          <span className="bg-gray-150 inline-block font-mono text-[9px] px-2 py-0.5 font-bold tracking-wider uppercase text-gray-600 border border-gray-200 bg-white">
                            {node.tier}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleDeleteNode(node.id, node.name)}
                        className="text-gray-400 hover:text-brand-red p-1 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Delete staged Node"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quick Coordinate Helpers */}
            <div className="mt-6 border-t border-gray-100 pt-5">
              <span className="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-3 font-semibold">
                INSERT STANDARD PRESETS
              </span>
              <div className="flex flex-wrap gap-2">
                {coordinatePresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    className="text-[10px] font-mono border border-gray-200 hover:bg-gray-50 px-2 py-1 text-gray-600 transition-colors uppercase cursor-pointer"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: New Node Definition Container (Span 7) */}
          <div className="lg:col-span-7 bg-white border-2 border-black p-8">
            <h3 className="font-display font-bold text-gray-900 text-xl mb-6 pb-2 border-b border-gray-100 inline-block">
              New Node Definition
            </h3>

            {formError && (
              <div className="mb-5 bg-red-50 border border-red-200 p-4 text-red-700 flex items-start space-x-3 text-sm animate-shake">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleAddNode} className="space-y-6">
              {/* Entity Identifier */}
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-gray-500 mb-2 font-semibold">
                  Entity Identifier
                </label>
                <input
                  type="text"
                  placeholder="e.g., SYD-CORE-01"
                  value={entityName}
                  onChange={(e) => {
                    setEntityName(e.target.value);
                    setFormError(null);
                  }}
                  className="w-full border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:border-black font-sans"
                />
              </div>

              {/* Address Autocomplete Search */}
              <div className="relative font-sans" ref={dropdownRef}>
                <label className="block text-xs font-mono uppercase tracking-wider text-gray-500 mb-2 font-semibold">
                  Node Address Search
                </label>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    placeholder="Search for an address... (e.g., Plaza Serene Acres)"
                    value={address}
                    onChange={(e) => handleAddressChange(e.target.value)}
                    onFocus={() => {
                      if (suggestions.length > 0) {
                        setIsDropdownOpen(true);
                      }
                    }}
                    className="w-full border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:border-black font-sans pr-10"
                  />
                  <div className="absolute right-3">
                    {isLoadingSuggestions ? (
                      <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <MapPin className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>

                {/* Autocomplete Dropdown List */}
                {isDropdownOpen && suggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 shadow-xl max-h-60 overflow-y-auto divide-y divide-gray-100 font-sans rounded-none transition-all duration-200">
                    {suggestions.map((suggestion, idx) => {
                      const title = suggestion.name || suggestion.street || suggestion.formatted.split(',')[0];
                      const subtitle = suggestion.address_line2 || (suggestion.city ? `${suggestion.city}, ` : '') + (suggestion.state ? `${suggestion.state}, ` : '') + suggestion.country;
                      return (
                        <div
                          key={suggestion.place_id || idx}
                          onClick={() => handleSelectSuggestion(suggestion)}
                          className="px-4 py-3 hover:bg-neutral-50 cursor-pointer text-left transition-colors flex items-start space-x-3"
                        >
                          <MapPin className="w-4 h-4 text-brand-red shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">
                              {title}
                            </p>
                            <p className="text-[11px] text-gray-400 truncate mt-0.5">
                              {subtitle}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Selected coordinates badge */}
                {selectedLat !== null && selectedLng !== null && (
                  <div className="mt-2.5 flex items-center space-x-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3.5 py-2 animate-fade-in w-fit font-mono">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Geocoded: lat {selectedLat.toFixed(5)}°, lng {selectedLng.toFixed(5)}°</span>
                  </div>
                )}
              </div>

              {/* Structural Hierarchy Tier Dropdown */}
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-gray-500 mb-2 font-semibold">
                  Structural Hierarchy Tier
                </label>
                <div className="relative">
                  <select
                    value={tier}
                    onChange={(e) => {
                      setTier(e.target.value as '' | 'Tier 1' | 'Tier 2' | 'Tier 3');
                      setFormError(null);
                    }}
                    className="w-full border border-gray-200 px-4 py-3 text-sm font-semibold focus:outline-none focus:border-black appearance-none bg-white cursor-pointer"
                  >
                    <option value="">Select Tier Level...</option>
                    <option value="Tier 1">Tier 1 - Primary Dispatch Hub</option>
                    <option value="Tier 2">Tier 2 - Regional Transit Station</option>
                    <option value="Tier 3">Tier 3 - Micro-Fulfillment center</option>
                  </select>
                  {/* Custom Arrow */}
                  <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
                    <svg
                      className="h-4 w-4 text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Button block matching heavy outline on select Manual Node */}
              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="bg-neutral-900 border border-neutral-900 hover:bg-black font-semibold font-mono text-sm uppercase text-white px-6 py-2.5 transition-colors flex items-center space-x-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-white" />
                  <span>Add Node</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Footer matching Screen 3 bottom indicators */}
      <footer className="bg-white border-t-2 border-black py-4 px-8 mt-12 bg-zinc-50/30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <span className="font-mono text-[10px] text-gray-400">
            © 2026 Praecantator Enterprise Systems. All rights reserved.
          </span>
          <div className="flex space-x-3">
            <button
              onClick={onBack}
              className="bg-[#595959] hover:bg-neutral-600 text-white px-6 py-2 font-mono text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer"
            >
              BACK
            </button>
            <button
              onClick={() => {
                setSuccessMsg('Staged nodes backup stored.');
                setTimeout(() => setSuccessMsg(null), 3000);
              }}
              className="border border-gray-200 px-6 py-2 bg-white hover:bg-gray-50 font-mono text-xs font-bold tracking-wider text-gray-500 hover:text-gray-900 transition-colors uppercase cursor-pointer"
            >
              SAVE DRAFT
            </button>
            <button
              onClick={handleContinueClick}
              disabled={nodes.length === 0}
              className={`font-mono text-xs font-bold tracking-wider px-8 py-2 uppercase transition-all flex items-center space-x-1.5 cursor-pointer ${
                nodes.length > 0
                  ? 'bg-brand-red hover:bg-brand-red-hover text-white'
                  : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
              }`}
            >
              <span>CONTINUE</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
