export type Page = 
  | 'COMPANY_PROFILE'
  | 'SOURCE_SELECTION' 
  | 'CSV_UPLOAD' 
  | 'ERP_CONNECTION' 
  | 'MANUAL_ENTRY' 
  | 'FINALIZING_SYNC' 
  | 'SUCCESS_SCREEN';

export type SourceType = 'CSV' | 'ERP' | 'MANUAL';

export interface FieldMapping {
  id: string;
  sourceFieldName: string;
  targetFieldName: string;
}

export interface ERPConfig {
  id: string;
  name: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'SYNCING' | 'connected' | 'disconnected' | 'syncing';
  description?: string;
  endpointUrl?: string;
  logoType?: string;
  apiKey?: string;
  tokenId?: string;
  lastSync?: string;
  type?: string;
}

export interface NodeItem {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  tier?: string;
  address?: string;
  nodeType?: string;
  supplierName?: string;
  supplierEmail?: string;
  supplierProductCategory?: string;
  supplierCategory?: string;
  slaDays?: number;
  incoterm?: string;
  backupSupplier?: boolean;
}
