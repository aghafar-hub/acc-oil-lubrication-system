export interface ParamDef {
  key: string;
  label: string;
  group: "wear_metal" | "contaminant" | "additive" | "physical";
  unit: string | null;
}

export const OIL_SAMPLE_PARAMETERS: ParamDef[] = [
  { key: "Ag", label: "Silver (Ag)", group: "wear_metal", unit: "ppm" },
  { key: "Al", label: "Aluminum (Al)", group: "wear_metal", unit: "ppm" },
  { key: "Cr", label: "Chromium (Cr)", group: "wear_metal", unit: "ppm" },
  { key: "Cu", label: "Copper (Cu)", group: "wear_metal", unit: "ppm" },
  { key: "Fe", label: "Iron (Fe)", group: "wear_metal", unit: "ppm" },
  { key: "Mo", label: "Molybdenum (Mo)", group: "wear_metal", unit: "ppm" },
  { key: "Ni", label: "Nickel (Ni)", group: "wear_metal", unit: "ppm" },
  { key: "Pb", label: "Lead (Pb)", group: "wear_metal", unit: "ppm" },
  { key: "Sn", label: "Tin (Sn)", group: "wear_metal", unit: "ppm" },

  { key: "K", label: "Potassium (K)", group: "contaminant", unit: "ppm" },
  { key: "Na", label: "Sodium (Na)", group: "contaminant", unit: "ppm" },
  { key: "Si", label: "Silicon (Si)", group: "contaminant", unit: "ppm" },

  { key: "B", label: "Boron (B)", group: "additive", unit: "ppm" },
  { key: "Ba", label: "Barium (Ba)", group: "additive", unit: "ppm" },
  { key: "Ca", label: "Calcium (Ca)", group: "additive", unit: "ppm" },
  { key: "Mg", label: "Magnesium (Mg)", group: "additive", unit: "ppm" },
  { key: "P", label: "Phosphorus (P)", group: "additive", unit: "ppm" },
  { key: "Zn", label: "Zinc (Zn)", group: "additive", unit: "ppm" },

  { key: "Visc40", label: "Viscosity @ 40°C", group: "physical", unit: "cSt" },
  { key: "Visc100", label: "Viscosity @ 100°C", group: "physical", unit: "cSt" },
  { key: "ViscIndex", label: "Viscosity Index", group: "physical", unit: null },
  { key: "TAN", label: "Total Acid Number", group: "physical", unit: "mg KOH/g" },
  { key: "Water", label: "Water Content", group: "physical", unit: "%" },
  { key: "PQIndex", label: "PQ Index", group: "physical", unit: null },
];

export const PARAM_GROUP_LABELS: Record<string, string> = {
  wear_metal: "Wear Metals",
  contaminant: "Contaminants",
  additive: "Additives",
  physical: "Physical Properties",
};

export const PARAM_GROUP_ORDER = ["wear_metal", "contaminant", "additive", "physical"];
