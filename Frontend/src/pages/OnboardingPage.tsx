import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import SourceSelection from './onboarding/SourceSelection';
import CsvUploader, { ParsedCsvData } from './onboarding/CsvUploader';
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
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileData>({
    companyName: "",
    industry: "Manufacturing",
    region: "Asia Pacific",
    companySize: "51-200",
    primaryContactName: "",
    primaryContactEmail: ""
  });
  const [selectedSource, setSelectedSource] = useState<SourceType>('CSV');
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

  const {
    data: onboardingStatus,
    isLoading: isOnboardingStatusLoading,
    isError: isOnboardingStatusError,
    refetch: refetchOnboardingStatus,
  } = useQuery({
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

  if (!hasToken) return null;

  if (isOnboardingStatusError) {
    return (
      <div className="w-full h-screen flex flex-col items-center justify-center bg-[#fafafa] gap-4 px-6">
        <p className="text-sm text-slate-600 text-center max-w-md">
          Could not verify onboarding status. Check that the backend is running and try again.
        </p>
        <button
          type="button"
          onClick={() => refetchOnboardingStatus()}
          className="px-6 py-2.5 bg-brand-red hover:bg-brand-red-hover text-white font-mono text-xs uppercase tracking-wider"
        >
          Retry
        </button>
      </div>
    );
  }

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

  const handleCsvUploaded = (suppliersData: ParsedCsvData, nodesData: ParsedCsvData) => {
    setTrackerFileName(suppliersData.file.name);
    setNodesFileName(nodesData.file.name);

    // Helper: case-insensitive column lookup
    const col = (row: Record<string, string>, ...keys: string[]): string => {
      for (const k of keys) {
        const found = Object.keys(row).find((rk) => rk.toLowerCase().trim() === k.toLowerCase());
        if (found && row[found] !== undefined && row[found] !== '') return row[found].trim();
      }
      return '';
    };

    // Build a lookup: node_name -> node row
    const nodeByName: Record<string, Record<string, string>> = {};
    for (const n of nodesData.rows) {
      const name = col(n, 'node_name', 'name', 'node');
      if (name) nodeByName[name.toLowerCase()] = n;
    }

    // Map supplier rows → NodeItem[], joining with node data via origin_nodes
    const csvNodes: NodeItem[] = suppliersData.rows.map((s, idx) => {
      const originNodeKey = col(s, 'origin_nodes', 'origin_node', 'node_name', 'node').toLowerCase();
      const nodeRow = nodeByName[originNodeKey] ?? {};

      const nodeName = col(nodeRow, 'node_name', 'name') || col(s, 'origin_nodes', 'origin_node', 'node_name') || `Node_${idx + 1}`;
      const address  = col(nodeRow, 'address', 'location', 'city') || col(s, 'city', 'country', 'location', 'address') || '';
      const nodeType = col(nodeRow, 'node_type', 'type', 'facility_type') || 'factory';

      const latRaw = col(nodeRow, 'lat', 'latitude') || col(s, 'lat', 'latitude');
      const lngRaw = col(nodeRow, 'lng', 'lon', 'longitude') || col(s, 'lng', 'lon', 'longitude');
      const lat = latRaw ? parseFloat(latRaw) : 0;
      const lng = lngRaw ? parseFloat(lngRaw) : 0;

      const tier = col(s, 'tier', 'supplier_tier') || 'Tier 1';
      const slaDaysRaw = col(s, 'sla_days', 'sla', 'lead_time_days');
      const slaDays = slaDaysRaw ? parseInt(slaDaysRaw, 10) : 0;
      const backupRaw = col(s, 'backup_supplier', 'is_backup').toLowerCase();
      const backupSupplier = backupRaw === 'true' || backupRaw === '1' || backupRaw === 'yes';

      return {
        id: `csv-n${idx + 1}`,
        name: nodeName,
        lat: isNaN(lat) ? 0 : lat,
        lng: isNaN(lng) ? 0 : lng,
        tier,
        address,
        nodeType,
        supplierName: col(s, 'supplier_n', 'supplier_name', 'name', 'company_name') || `Supplier_${idx + 1}`,
        supplierEmail: col(s, 'email', 'supplier_email', 'contact_email') || '',
        supplierProductCategory: col(s, 'products_categories', 'product_categories', 'products', 'product') || '',
        supplierCategory: col(s, 'category', 'supplier_category', 'sector') || '',
        slaDays: isNaN(slaDays) ? 0 : slaDays,
        incoterm: col(s, 'incoterm', 'inco_term', 'trade_term') || 'FOB',
        backupSupplier,
      };
    });

    // Also incorporate any nodes that were NOT referenced by any supplier
    const referencedNodeKeys = new Set(
      suppliersData.rows.map((s) =>
        col(s, 'origin_nodes', 'origin_node', 'node_name', 'node').toLowerCase()
      )
    );
    for (const [key, nodeRow] of Object.entries(nodeByName)) {
      if (!referencedNodeKeys.has(key)) {
        const latRaw = col(nodeRow, 'lat', 'latitude');
        const lngRaw = col(nodeRow, 'lng', 'lon', 'longitude');
        const lat = latRaw ? parseFloat(latRaw) : 0;
        const lng = lngRaw ? parseFloat(lngRaw) : 0;
        csvNodes.push({
          id: `csv-standalone-${key}`,
          name: col(nodeRow, 'node_name', 'name') || key,
          lat: isNaN(lat) ? 0 : lat,
          lng: isNaN(lng) ? 0 : lng,
          tier: col(nodeRow, 'tier') || 'Tier 1',
          address: col(nodeRow, 'address', 'location', 'city') || '',
          nodeType: col(nodeRow, 'node_type', 'type') || 'factory',
          supplierName: '',
          supplierEmail: '',
        });
      }
    }

    const autoMappings: FieldMapping[] = [
      { id: 'm1', sourceFieldName: 'supplier_n', targetFieldName: 'supplier_name' },
      { id: 'm2', sourceFieldName: 'tier', targetFieldName: 'supplier_tier' },
      { id: 'm3', sourceFieldName: 'node_name', targetFieldName: 'node_name' },
      { id: 'm4', sourceFieldName: 'address', targetFieldName: 'node_address' },
    ];
    setFieldMappings(autoMappings);
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
      queryClient.setQueryData(["onboarding-status", userId], {
        user_id: userId,
        complete: true,
        updated_at: new Date().toISOString(),
      });
      await queryClient.refetchQueries({ queryKey: ["onboarding-status", userId] });
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

  const handleFinishSuccess = async () => {
    await queryClient.refetchQueries({ queryKey: ["onboarding-status", userId] });
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
