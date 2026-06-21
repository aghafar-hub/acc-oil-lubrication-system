/**
 * Canonical parameter list for the Oil Sample Center, matching the
 * reference screenshot's groupings exactly (Section 12.7):
 * Sample Info, Lubricant rating, Wear metals (ppm), Contaminants,
 * Additives, Physical properties.
 *
 * Used by both manual data entry (validates incoming param keys) and
 * the PDF extraction parser (matches lab report labels to these keys).
 */

export interface ParamDef {
  key: string;
  label: string;
  group: "sample_info" | "lubricant_rating" | "wear_metal" | "contaminant" | "additive" | "physical";
  unit: string | null;
  // Typical caution/alert thresholds — used as PDF-extraction fallback
  // when the lab report doesn't print its own status flag. Always
  // editable by the human reviewer before saving (Section 12.7.1).
  cautionAbove?: number;
  alertAbove?: number;
}

export const OIL_SAMPLE_PARAMETERS: ParamDef[] = [
  // Wear metals (ppm)
  { key: "Ag", label: "Silver (Ag)", group: "wear_metal", unit: "ppm", cautionAbove: 3, alertAbove: 6 },
  { key: "Al", label: "Aluminum (Al)", group: "wear_metal", unit: "ppm", cautionAbove: 15, alertAbove: 30 },
  { key: "Cr", label: "Chromium (Cr)", group: "wear_metal", unit: "ppm", cautionAbove: 10, alertAbove: 20 },
  { key: "Cu", label: "Copper (Cu)", group: "wear_metal", unit: "ppm", cautionAbove: 20, alertAbove: 40 },
  { key: "Fe", label: "Iron (Fe)", group: "wear_metal", unit: "ppm", cautionAbove: 50, alertAbove: 100 },
  { key: "Mo", label: "Molybdenum (Mo)", group: "wear_metal", unit: "ppm", cautionAbove: 5, alertAbove: 10 },
  { key: "Ni", label: "Nickel (Ni)", group: "wear_metal", unit: "ppm", cautionAbove: 5, alertAbove: 10 },
  { key: "Pb", label: "Lead (Pb)", group: "wear_metal", unit: "ppm", cautionAbove: 15, alertAbove: 30 },
  { key: "Sn", label: "Tin (Sn)", group: "wear_metal", unit: "ppm", cautionAbove: 5, alertAbove: 10 },

  // Contaminants (ppm)
  { key: "K", label: "Potassium (K)", group: "contaminant", unit: "ppm", cautionAbove: 10, alertAbove: 20 },
  { key: "Na", label: "Sodium (Na)", group: "contaminant", unit: "ppm", cautionAbove: 20, alertAbove: 50 },
  { key: "Si", label: "Silicon (Si)", group: "contaminant", unit: "ppm", cautionAbove: 15, alertAbove: 25 },

  // Additives (ppm)
  { key: "B", label: "Boron (B)", group: "additive", unit: "ppm" },
  { key: "Ba", label: "Barium (Ba)", group: "additive", unit: "ppm" },
  { key: "Ca", label: "Calcium (Ca)", group: "additive", unit: "ppm" },
  { key: "Mg", label: "Magnesium (Mg)", group: "additive", unit: "ppm" },
  { key: "P", label: "Phosphorus (P)", group: "additive", unit: "ppm" },
  { key: "Zn", label: "Zinc (Zn)", group: "additive", unit: "ppm" },

  // Physical properties
  { key: "Visc40", label: "Viscosity @ 40°C", group: "physical", unit: "cSt" },
  { key: "Visc100", label: "Viscosity @ 100°C", group: "physical", unit: "cSt" },
  { key: "ViscIndex", label: "Viscosity Index", group: "physical", unit: null },
  { key: "TAN", label: "Total Acid Number", group: "physical", unit: "mg KOH/g" },
  { key: "Water", label: "Water Content", group: "physical", unit: "%" },
  { key: "PQIndex", label: "PQ Index", group: "physical", unit: null },

  // Sample info / lubricant rating
  { key: "OilHours", label: "Oil Hours", group: "sample_info", unit: "hrs" },
  { key: "MakeupAdded", label: "Make-up Oil Added", group: "sample_info", unit: "L" },
  { key: "OverallCondition", label: "Overall Lubricant Condition", group: "lubricant_rating", unit: null },
];

export function paramDef(key: string): ParamDef | undefined {
  return OIL_SAMPLE_PARAMETERS.find((p) => p.key === key);
}

export type ParamStatusValue = "NORMAL" | "CAUTION" | "ALERT";

/** Falls back to threshold-based status when a lab report has no explicit flag. */
export function statusFromValue(key: string, value: number | null): ParamStatusValue {
  if (value == null) return "NORMAL";
  const def = paramDef(key);
  if (!def) return "NORMAL";
  if (def.alertAbove != null && value >= def.alertAbove) return "ALERT";
  if (def.cautionAbove != null && value >= def.cautionAbove) return "CAUTION";
  return "NORMAL";
}
