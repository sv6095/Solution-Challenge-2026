import React from "react";
import { Bell, Settings } from "lucide-react";

export interface CompanyProfileData {
  companyName: string;
  industry: string;
  region: string;
  companySize: string;
  primaryContactName: string;
  primaryContactEmail: string;
}

interface CompanyProfileProps {
  embedded?: boolean;
  data: CompanyProfileData;
  onChange: (data: CompanyProfileData) => void;
  onNext: () => void;
}

export default function CompanyProfile({ embedded, data, onChange, onNext }: CompanyProfileProps) {
  return (
    <div className={embedded ? "bg-slate-50 font-headline" : "min-h-screen bg-slate-50 font-headline"}>
      {/* Navbar */}
      {!embedded && (
        <nav className="h-14 flex items-center justify-between px-6 bg-white border-b border-slate-200">
          <div className="flex items-center gap-3">
            <img src="/Praecantator.png" alt="Logo" className="w-8 h-8 object-contain" />
            <span className="font-headline text-xl font-bold text-red-500">Praecantator</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-label-sm text-slate-500 uppercase tracking-widest">Onboarding Protocol</span>
            <Bell size={18} className="text-slate-500" />
            <Settings size={18} className="text-slate-500" />
          </div>
        </nav>
      )}

      {/* Progress bar (Old style for company step) */}
      <div className="flex items-center justify-center gap-4 py-8 max-w-2xl mx-auto">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-headline font-bold bg-red-500 text-white">
              1
            </div>
            <span className="text-label-sm uppercase tracking-widest text-red-500">
              Company Profile
            </span>
          </div>
          <div className="w-32 h-0.5 bg-slate-100" />
          <div className="flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-headline font-bold bg-slate-100 text-slate-500">
              2
            </div>
            <span className="text-label-sm uppercase tracking-widest text-slate-500">
              Supply Chain
            </span>
          </div>
        </div>
      </div>

      <div className={embedded ? "grid lg:grid-cols-1 gap-0" : "grid lg:grid-cols-[45%_55%] gap-0 min-h-[calc(100vh-10rem)]"}>
        {/* Left branding */}
        {!embedded && (
          <div className="p-12 flex flex-col justify-center bg-sky-50 border-r border-sky-100">
            <h1 className="text-display-lg leading-tight mb-6 text-slate-900">
              Fortify Your <span className="text-sentinel">Infrastructure.</span>
            </h1>
            <p className="text-body-md text-slate-600 max-w-md mb-10">
              Complete the structural configuration to initialize the Kinetic Fortress. Your data will be processed through our neural risk mapping engine.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-sky-100 rounded-lg p-5 shadow-sm">
                <p className="font-headline text-2xl font-bold text-sentinel">99.9%</p>
                <p className="text-label-sm text-slate-500 uppercase tracking-widest">Uptime Monitoring</p>
              </div>
              <div className="bg-white border border-sky-100 rounded-lg p-5 shadow-sm">
                <p className="font-headline text-2xl font-bold text-sentinel">ZERO</p>
                <p className="text-label-sm text-slate-500 uppercase tracking-widest">Latency Lag</p>
              </div>
            </div>
          </div>
        )}

        {/* Right form */}
        <div className="p-12 bg-white border-b border-slate-200 overflow-y-auto">
          <div className="space-y-6">
            <div>
              <h2 className="font-headline text-xl font-bold mb-1">Company Profile</h2>
              <p className="text-body-md text-slate-500">Define your operational theater and scale.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-label-sm text-slate-500 uppercase tracking-widest block mb-2">Company name *</label>
                <input 
                  value={data.companyName} 
                  onChange={(e) => onChange({ ...data, companyName: e.target.value })} 
                  className="input-sentinel w-full px-4 py-3 rounded-sm" 
                  placeholder="Acme Manufacturing" 
                  required 
                />
              </div>
              <div>
                <label className="text-label-sm text-slate-500 uppercase tracking-widest block mb-2">Primary contact name</label>
                <input 
                  value={data.primaryContactName} 
                  onChange={(e) => onChange({ ...data, primaryContactName: e.target.value })} 
                  className="input-sentinel w-full px-4 py-3 rounded-sm" 
                  placeholder="Jane Doe" 
                />
              </div>
              <div>
                <label className="text-label-sm text-slate-500 uppercase tracking-widest block mb-2">Primary contact email *</label>
                <input 
                  value={data.primaryContactEmail} 
                  onChange={(e) => onChange({ ...data, primaryContactEmail: e.target.value })} 
                  className="input-sentinel w-full px-4 py-3 rounded-sm" 
                  placeholder="jane@acme.com" 
                  type="email" 
                  required 
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-label-sm text-slate-500 uppercase tracking-widest block mb-2">Primary Industry</label>
                <select 
                  value={data.industry} 
                  onChange={(e) => onChange({ ...data, industry: e.target.value })} 
                  aria-label="Primary Industry" 
                  className="input-sentinel w-full px-4 py-3 rounded-sm bg-surface"
                >
                  <option>Manufacturing</option>
                  <option>Pharma</option>
                  <option>Electronics</option>
                  <option>Food &amp; Beverage</option>
                  <option>Retail</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label className="text-label-sm text-slate-500 uppercase tracking-widest block mb-2">Operational Region</label>
                <select 
                  value={data.region} 
                  onChange={(e) => onChange({ ...data, region: e.target.value })} 
                  aria-label="Operational Region" 
                  className="input-sentinel w-full px-4 py-3 rounded-sm bg-surface"
                >
                  <option>Asia Pacific</option>
                  <option>Europe</option>
                  <option>North America</option>
                  <option>Latin America</option>
                  <option>Middle East &amp; Africa</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-label-sm text-slate-500 uppercase tracking-widest block mb-2">Company Size (Employee Count)</label>
              <div className="grid grid-cols-4 gap-2">
                {["1-50", "51-200", "201-1000", "1000+"].map((size) => (
                  <button
                    key={size}
                    onClick={() => onChange({ ...data, companySize: size })}
                    className={`py-3 rounded-sm font-medium transition-colors ${
                      data.companySize === size ? "bg-red-500 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-white/10"
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-10 pt-6 border-t border-slate-200">
            <div />
            <button
              onClick={onNext}
              className="bg-foreground text-white px-6 py-3 rounded-sm font-medium hover:opacity-90 transition-opacity"
            >
              Next Step →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
