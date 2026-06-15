import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import SourceSelection from './onboarding/SourceSelection';
import CsvUploader from './onboarding/CsvUploader';
import ErpConnection from './onboarding/ErpConnection';
import ManualNodeEntry from './onboarding/ManualNodeEntry';
import FinalizingScreen from './onboarding/FinalizingScreen';
import SuccessScreen from './onboarding/SuccessScreen';
import CompanyProfile, { CompanyProfileData } from './onboarding/CompanyProfile';
import { SourceType, ERPConfig, NodeItem, FieldMapping, Page } from './onboarding/types';
import { api, getUserId, getAccessToken } from "@/lib/api";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Props = {
  embedded?: boolean;
  returnTo?: string;
};

export default function OnboardingPage(props: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const embedded = props.embedded ?? searchParams.get("embedded") === "1";
  const returnTo = (props.returnTo ?? searchParams.get("returnTo")) || "/dashboard";

  const userId = useMemo(() => getUserId(), []);
  const hasToken = useMemo(() => Boolean(getAccessToken()), []);
  const queryClient = useQueryClient();

  const [currentPage, setCurrentPage] = useState<Page>('COMPANY_PROFILE');

  const { data: onboardingStatus, isLoading: isOnboardingStatusLoading } = useQuery({
    queryKey: ["onboarding-status", userId],
    queryFn: () => api.onboarding.status(userId),
    enabled: hasToken && !!userId,
  });

  useEffect(() => {
    if (!hasToken) {
      navigate("/login");
    }
  }, [hasToken, navigate]);

  useEffect(() => {
    if (hasToken && onboardingStatus?.complete && !embedded && currentPage !== 'SUCCESS_SCREEN') {
      navigate(returnTo);
    }
  }, [hasToken, onboardingStatus, embedded, currentPage, navigate, returnTo]);

  // Autofill data
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileData>({
    companyName: "",
    industry: "Manufacturing",
    region: "Asia Pacific",
    companySize: "51-200",
    primaryContactName: "",
    primaryContactEmail: ""
  });

  useEffect(() => {
    if (!userId) return;
    api.auth.profile(userId).then((reg) => {
      setCompanyProfile(prev => ({
        ...prev,
        companyName: prev.companyName || reg.company_name || "",
        primaryContactName: prev.primaryContactName || reg.full_name || "",
        primaryContactEmail: prev.primaryContactEmail || reg.email || ""
      }));
    }).catch(() => {});
  }, [userId]);

  const [selectedSource, setSelectedSource] = useState<SourceType>('CSV');

  if (!hasToken) return null;

  if (isOnboardingStatusLoading || (hasToken && !onboardingStatus)) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-[#fafafa]">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-[3px] border-muted/80 border-t-red-600 animate-spin" />
          <div className="absolute w-6 h-6 rounded-full bg-red-600/10 animate-pulse" />
        </div>
        <span className="text-[10px] font-headline font-bold uppercase tracking-[0.2em] text-slate-500 mt-4 animate-pulse">
          Verifying security authorization...
        </span>
      </div>
    );
  }

  if (hasToken && onboardingStatus?.complete && !embedded && currentPage !== 'SUCCESS_SCREEN') {
    return null;
  }

  // Input States Cached during flow
  const [trackerFileName, setTrackerFileName] = useState<string>('suppliers_v2.csv');
  const [nodesFileName, setNodesFileName] = useState<string>('nodes_v2.csv');
  const [connectedErps, setConnectedErps] = useState<ERPConfig[]>([]);
  const [stagedNodes, setStagedNodes] = useState<NodeItem[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([
    { id: 'm1', sourceFieldName: 'supplier_n', targetFieldName: 'supplier_name' },
    { id: 'm2', sourceFieldName: 'tier', targetFieldName: 'supplier_tier' },
    { id: 'm3', sourceFieldName: 'node_name', targetFieldName: 'node_name' },
    { id: 'm4', sourceFieldName: 'address', targetFieldName: 'node_address' },
  ]);

  // Page Navigation Triggers
  const handleSourceSelect = (source: SourceType) => {
    setSelectedSource(source);
  };

  const handleSourceContinue = () => {
    if (selectedSource === 'ERP') {
      setCurrentPage('ERP_CONNECTION');
    } else if (selectedSource === 'CSV') {
      setCurrentPage('CSV_UPLOAD');
    } else if (selectedSource === 'MANUAL') {
      setCurrentPage('MANUAL_ENTRY');
    }
  };

  const handleSourceCancel = () => {
    // If embedded, returning "cancels" onboarding
    if (embedded) {
      navigate(returnTo);
    } else {
      setCurrentPage('COMPANY_PROFILE');
    }
  };

  const handleCsvUploaded = (suppliersName: string, nodesName: string) => {
    setTrackerFileName(suppliersName);
    setNodesFileName(nodesName);
    
    const autoMappings: FieldMapping[] = [
      { id: 'm1', sourceFieldName: 'supplier_n', targetFieldName: 'supplier_name' },
      { id: 'm2', sourceFieldName: 'tier', targetFieldName: 'supplier_tier' },
      { id: 'm3', sourceFieldName: 'node_name', targetFieldName: 'node_name' },
      { id: 'm4', sourceFieldName: 'address', targetFieldName: 'node_address' },
    ];
    setFieldMappings(autoMappings);

    // Setup typical CSV mapped nodes
    const csvNodes: NodeItem[] = [
      {
        id: 'csv-n1', name: 'Factory A', lat: 13.0827, lng: 80.2707, tier: 'Tier 1',
        address: 'Chennai India', nodeType: 'factory', supplierName: 'Supplier_1',
        supplierEmail: 'supplier1@example.com', supplierProductCategory: 'Chemicals_Products',
        supplierCategory: 'Chemicals', slaDays: 15, incoterm: 'FOB', backupSupplier: true,
      },
      {
        id: 'csv-n2', name: 'Warehouse 1', lat: 19.0760, lng: 72.8777, tier: 'Tier 1',
        address: 'Mumbai India', nodeType: 'warehouse', supplierName: 'Supplier_2',
        supplierEmail: 'supplier2@example.com', supplierProductCategory: 'Automotive_Products',
        supplierCategory: 'Automotiv', slaDays: 12, incoterm: 'CIF', backupSupplier: true,
      },
      {
        id: 'csv-n3', name: 'Port Hub', lat: 18.9500, lng: 72.9500, tier: 'Tier 1',
        address: 'Nhava Sheva Port', nodeType: 'port', supplierName: 'Inter-modal Transit Hub',
        supplierEmail: 'port_dispatch@example.com', supplierProductCategory: 'Logistics',
        supplierCategory: 'Logistics', slaDays: 2, incoterm: 'FOB', backupSupplier: false,
      },
      {
        id: 'csv-n4', name: 'Factory B', lat: 12.9716, lng: 77.5946, tier: 'Tier 2',
        address: 'Bangalore India', nodeType: 'factory', supplierName: 'Supplier_3',
        supplierEmail: 'supplier3@example.com', supplierProductCategory: 'Electronics_Products',
        supplierCategory: 'Electronics', slaDays: 8, incoterm: 'EXW', backupSupplier: false,
      },
      {
        id: 'csv-n5', name: 'Distribution Center', lat: 28.7041, lng: 77.1025, tier: 'Tier 2',
        address: 'Delhi India', nodeType: 'warehouse', supplierName: 'Supplier_4',
        supplierEmail: 'supplier4@example.com', supplierProductCategory: 'Mechanical_Parts',
        supplierCategory: 'Industrials', slaDays: 10, incoterm: 'FOB', backupSupplier: true,
      }
    ];

    setStagedNodes(csvNodes);
    setCurrentPage('FINALIZING_SYNC');
  };

  const handleErpConnected = (connected: ERPConfig[]) => {
    setConnectedErps(connected);
    const sapNodes: NodeItem[] = [
      { id: 'sap-n1', name: 'Tokyo Logistics Hub', lat: 35.6895, lng: 139.6917, tier: 'Tier 1', supplierName: 'Tokyo Suppliers', supplierEmail: 'tokyo@example.com' },
      { id: 'sap-n2', name: 'Berlin Relay Alpha', lat: 52.5200, lng: 13.4050, tier: 'Tier 2', supplierName: 'Berlin Core', supplierEmail: 'berlin@example.com' },
      { id: 'sap-n3', name: 'Sydney Dispatch Center', lat: -33.8688, lng: 151.2093, tier: 'Tier 1', supplierName: 'Sydney Dispatch', supplierEmail: 'sydney@example.com' },
      { id: 'sap-n4', name: 'London Station Delta', lat: 51.5074, lng: -0.1278, tier: 'Tier 2', supplierName: 'London Co.', supplierEmail: 'london@example.com' },
    ];
    setStagedNodes(sapNodes);
    setCurrentPage('FINALIZING_SYNC');
  };

  const handleManualNodesStaging = (nodes: NodeItem[]) => {
    setStagedNodes(nodes);
    setCurrentPage('FINALIZING_SYNC');
  };

  const submitOnboarding = async () => {
    try {
      await api.onboarding.complete({
        user_id: userId,
        company_name: companyProfile.companyName || "Acme Corporation",
        industry: companyProfile.industry || "Manufacturing",
        region: companyProfile.region || "Global",
        primary_contact_name: companyProfile.primaryContactName || "Admin",
        primary_contact_email: companyProfile.primaryContactEmail || "admin@example.com",
        company_size: companyProfile.companySize || "51-200",
        logistics_nodes: stagedNodes.map((n) => ({
          name: n.name,
          node_type: n.nodeType || "factory",
          address: n.address || "Unknown Address",
          tier: n.tier || "Tier 1",
          lat: n.lat || 0,
          lng: n.lng || 0,
          transport_modes: { sea: true, air: true, land: true },
          daily_throughput_usd: 0,
          safety_stock_days: "0",
          critical_threshold_pct: "60",
        })),
        suppliers: stagedNodes.map((n, idx) => ({
          id: `sup_${idx + 1}`,
          supplier_id: `sup_${idx + 1}`,
          name: n.supplierName || `Supplier for ${n.name}`,
          email: n.supplierEmail || `supplier${idx}@example.com`,
          city: "",
          country: "Global",
          tier: n.tier || "Tier 1",
          transport_mode: "mixed",
          category: n.supplierCategory || "General",
          products: n.supplierProductCategory || "General",
          origin_nodes: n.name,
          contract_sla_days: String(n.slaDays || 0),
          backup_supplier: n.backupSupplier || false,
          incoterm: n.incoterm || "FOB",
          lat: 0.0,
          lng: 0.0,
        })),
        backup_suppliers: stagedNodes.filter((n) => n.backupSupplier).map((n) => ({ 
          name: n.supplierName || `Supplier for ${n.name}`, 
          email: n.supplierEmail || `supplier@example.com`, 
          city: "", 
          country: "Global", 
          category: n.supplierCategory || "General" 
        })),
        alert_threshold: 60,
        transport_preferences: { sea: true, air: true, land: true },
        gmail_oauth_token: null,
        slack_webhook: null,
      });
      queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
      toast.success("Onboarding complete.");
      setCurrentPage('SUCCESS_SCREEN');
    } catch {
      toast.error("Failed to save onboarding.");
      resetFlow();
    }
  };

  const resetFlow = () => {
    setCurrentPage('SOURCE_SELECTION');
    setSelectedSource('CSV');
    setConnectedErps([]);
    setStagedNodes([]);
  };

  const handleFinishSuccess = () => {
    navigate(returnTo);
  };

  return (
    <div id="app-root-wrapper" className="min-h-screen bg-[#fafafa]">
      {currentPage === 'COMPANY_PROFILE' && (
        <CompanyProfile
          embedded={embedded}
          data={companyProfile}
          onChange={setCompanyProfile}
          onNext={() => setCurrentPage('SOURCE_SELECTION')}
        />
      )}

      {currentPage === 'SOURCE_SELECTION' && (
        <SourceSelection
          initialSource={selectedSource}
          onSelect={handleSourceSelect}
          onContinue={handleSourceContinue}
          onCancel={handleSourceCancel}
        />
      )}

      {currentPage === 'CSV_UPLOAD' && (
        <CsvUploader
          onBack={() => setCurrentPage('SOURCE_SELECTION')}
          onFileUploaded={handleCsvUploaded}
        />
      )}

      {currentPage === 'ERP_CONNECTION' && (
        <ErpConnection
          onBack={() => setCurrentPage('SOURCE_SELECTION')}
          onContinue={handleErpConnected}
        />
      )}

      {currentPage === 'MANUAL_ENTRY' && (
        <ManualNodeEntry
          onBack={() => setCurrentPage('SOURCE_SELECTION')}
          onContinue={handleManualNodesStaging}
        />
      )}

      {currentPage === 'FINALIZING_SYNC' && (
        <FinalizingScreen
          nodeCount={stagedNodes.length || 6}
          onCancel={resetFlow}
          onComplete={submitOnboarding}
        />
      )}

      {currentPage === 'SUCCESS_SCREEN' && (
        <SuccessScreen
          nodeCount={stagedNodes.length || 14}
          onRestart={handleFinishSuccess}
        />
      )}
    </div>
  );
}
