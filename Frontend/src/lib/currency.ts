/**
 * currency.ts — INR conversion + Indian number formatting
 *
 * All monetary values in the backend are stored as USD.
 * This module converts them to INR and formats using the Indian
 * numbering system (Lakhs / Crores).
 *
 * Usage:
 *   import { fmtINR } from "@/lib/currency";
 *   fmtINR(1000000)  // "₹83.50 L"   (1M USD → ~83.5L INR)
 *   fmtINR(12000000) // "₹10.02 Cr"  (12M USD → ~10 Cr INR)
 */

/** Live-ish USD → INR conversion rate. Update periodically. */
export const USD_TO_INR = 83.5;

/** Convert a USD amount to INR. */
export function usdToInr(usd: number): number {
  return (Number.isFinite(usd) ? usd : 0) * USD_TO_INR;
}

/**
 * Format a USD amount as INR with Indian abbreviation:
 *  - ≥ 1 Crore (10 000 000):  "₹X.XX Cr"
 *  - ≥ 1 Lakh  (100 000):     "₹X.XX L"
 *  - otherwise:               "₹X,XX,XXX" (en-IN formatting)
 *
 * @param usd  Amount in USD
 */
export function fmtINR(usd: number): string {
  const inr = usdToInr(usd);
  if (inr >= 10_000_000) {
    return `₹${(inr / 10_000_000).toFixed(2)} Cr`;
  }
  if (inr >= 100_000) {
    return `₹${(inr / 100_000).toFixed(2)} L`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(inr));
}

/**
 * Same as fmtINR but accepts a value that may already be in INR
 * (for cases where the backend has already converted).
 */
export function fmtINRRaw(inr: number): string {
  const v = Number.isFinite(inr) ? inr : 0;
  if (v >= 10_000_000) {
    return `₹${(v / 10_000_000).toFixed(2)} Cr`;
  }
  if (v >= 100_000) {
    return `₹${(v / 100_000).toFixed(2)} L`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(v));
}
