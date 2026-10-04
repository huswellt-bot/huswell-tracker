export const COSTING_MATERIAL_CATEGORIES = [
  "PP White",
  "Vinyl Glossy",
  "Vinyl Matte",
] as const;

export type CostingMaterialCategory =
  (typeof COSTING_MATERIAL_CATEGORIES)[number];

export type CostingLineInput = {
  id?: string;
  material_category: CostingMaterialCategory | string;
  item_description?: string | null;
  width_mm: number | string;
  height_mm: number | string;
  quantity: number | string;
  finish?: string | null;
};

export type CostingMaterialInput = {
  material_category: CostingMaterialCategory | string;
  display_name?: string | null;
  roll_width_m: number | string;
  roll_length_m: number | string;
  roll_cost: number | string;
  required_rolls?: number | string | null;
  linear_meters_used?: number | string | null;
};

export type PrintCostingDefaultsMaterial = {
  display_name: string;
  roll_width_m: number;
  roll_length_m: number;
  roll_cost: number;
};

export type PrintCostingDefaults = {
  hp_latex_rate: number;
  waste_allowance: number;
  formula_version: string;
  materials: Record<CostingMaterialCategory, PrintCostingDefaultsMaterial>;
};

export type CostingAdditionalCostInput = {
  label: string;
  amount: number | string;
  note?: string | null;
};

export type CostingMaterialCalculation = {
  material_category: CostingMaterialCategory;
  display_name: string;
  roll_width_m: number;
  roll_length_m: number;
  roll_cost: number;
  total_area_sqm: number;
  total_quantity: number;
  linear_meters_used: number;
  required_rolls: number;
  allocated_material_cost: number;
  full_roll_purchase_cost: number;
  net_print_cost: number;
  printing_with_allowance: number;
  consumption_cost: number;
  procurement_cost: number;
};

export type CostingCalculation = {
  formula_version: string;
  hp_latex_rate: number;
  waste_allowance: number;
  total_quantity: number;
  total_area_sqm: number;
  material_consumption: number;
  full_roll_purchase: number;
  net_print_cost: number;
  printing_with_allowance: number;
  direct_consumption_cost: number;
  direct_procurement_cost: number;
  additional_costs: number;
  project_cost_consumption: number;
  project_cost_procurement: number;
  cost_per_piece: number;
  material_rows: CostingMaterialCalculation[];
  additional_cost_rows: {
    label: string;
    amount: number;
    note: string;
  }[];
};

export const DEFAULT_HP_LATEX_RATE = 99.19;
export const DEFAULT_WASTE_ALLOWANCE = 0.05;
export const DEFAULT_FORMULA_VERSION = "hp-latex-700w-v1";

export const MATERIAL_RULE_DEFAULTS: Record<
  CostingMaterialCategory,
  Omit<CostingMaterialInput, "material_category">
> = {
  "PP White": {
    display_name: "PP White Self-Adhesive",
    roll_width_m: 1.27,
    roll_length_m: 30,
    roll_cost: 2200,
    required_rolls: null,
    linear_meters_used: null,
  },
  "Vinyl Glossy": {
    display_name: "Vinyl Glossy",
    roll_width_m: 1.37,
    roll_length_m: 50,
    roll_cost: 3300,
    required_rolls: null,
    linear_meters_used: null,
  },
  "Vinyl Matte": {
    display_name: "Vinyl Matte",
    roll_width_m: 1.37,
    roll_length_m: 50,
    roll_cost: 3300,
    required_rolls: null,
    linear_meters_used: null,
  },
};

export const DEFAULT_PRINT_COSTING_DEFAULTS: PrintCostingDefaults = {
  hp_latex_rate: DEFAULT_HP_LATEX_RATE,
  waste_allowance: DEFAULT_WASTE_ALLOWANCE,
  formula_version: DEFAULT_FORMULA_VERSION,
  materials: {
    "PP White": {
      display_name: MATERIAL_RULE_DEFAULTS["PP White"].display_name ?? "PP White Self-Adhesive",
      roll_width_m: 1.27,
      roll_length_m: 30,
      roll_cost: 2200,
    },
    "Vinyl Glossy": {
      display_name: MATERIAL_RULE_DEFAULTS["Vinyl Glossy"].display_name ?? "Vinyl Glossy",
      roll_width_m: 1.37,
      roll_length_m: 50,
      roll_cost: 3300,
    },
    "Vinyl Matte": {
      display_name: MATERIAL_RULE_DEFAULTS["Vinyl Matte"].display_name ?? "Vinyl Matte",
      roll_width_m: 1.37,
      roll_length_m: 50,
      roll_cost: 3300,
    },
  },
};

export const DEFAULT_ADDITIONAL_COSTS = [
  "Cutting / finishing",
  "Labor",
  "Packing",
  "Delivery / logistics",
  "Other overhead",
].map((label) => ({ label, amount: 0, note: "" }));

const finiteNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const nonNegative = (value: unknown) => Math.max(0, finiteNumber(value));
const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const materialCategory = (value: unknown): CostingMaterialCategory =>
  COSTING_MATERIAL_CATEGORIES.includes(value as CostingMaterialCategory)
    ? (value as CostingMaterialCategory)
    : "PP White";

const materialDefaults = (category: CostingMaterialCategory) =>
  MATERIAL_RULE_DEFAULTS[category];

export function normalizePrintCostingDefaults(value: unknown): PrintCostingDefaults {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const sourceMaterials = source.materials && typeof source.materials === "object"
    ? source.materials as Record<string, unknown>
    : {};
  const numberOrDefault = (candidate: unknown, fallback: number) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const materials = Object.fromEntries(
    COSTING_MATERIAL_CATEGORIES.map((category) => {
      const fallback = DEFAULT_PRINT_COSTING_DEFAULTS.materials[category];
      const raw = sourceMaterials[category] && typeof sourceMaterials[category] === "object"
        ? sourceMaterials[category] as Record<string, unknown>
        : {};
      return [category, {
        display_name: typeof raw.display_name === "string" && raw.display_name.trim()
          ? raw.display_name.trim()
          : fallback.display_name,
        roll_width_m: Math.max(0, numberOrDefault(raw.roll_width_m, fallback.roll_width_m)),
        roll_length_m: Math.max(0, numberOrDefault(raw.roll_length_m, fallback.roll_length_m)),
        roll_cost: Math.max(0, numberOrDefault(raw.roll_cost, fallback.roll_cost)),
      } satisfies PrintCostingDefaultsMaterial];
    }),
  ) as Record<CostingMaterialCategory, PrintCostingDefaultsMaterial>;
  return {
    hp_latex_rate: Math.max(0, numberOrDefault(source.hp_latex_rate, DEFAULT_HP_LATEX_RATE)),
    waste_allowance: Math.min(1, Math.max(0, numberOrDefault(source.waste_allowance, DEFAULT_WASTE_ALLOWANCE))),
    formula_version: typeof source.formula_version === "string" && source.formula_version.trim()
      ? source.formula_version.trim()
      : DEFAULT_FORMULA_VERSION,
    materials,
  };
}

export function calculateCosting(input: {
  hpLatexRate?: number | string | null;
  wasteAllowance?: number | string | null;
  items?: CostingLineInput[];
  materials?: CostingMaterialInput[];
  additionalCosts?: CostingAdditionalCostInput[];
  formulaVersion?: string;
}): CostingCalculation {
  const hpLatexRate = nonNegative(
    input.hpLatexRate ?? DEFAULT_HP_LATEX_RATE,
  );
  const wasteAllowance = Math.max(
    0,
    Math.min(1, finiteNumber(input.wasteAllowance, DEFAULT_WASTE_ALLOWANCE)),
  );
  const items = input.items ?? [];
  const materials = input.materials ?? [];
  const materialRows = COSTING_MATERIAL_CATEGORIES.map((category) => {
    const defaults = materialDefaults(category);
    const material = materials.find(
      (candidate) => materialCategory(candidate.material_category) === category,
    );
    const rollWidth = nonNegative(material?.roll_width_m ?? defaults.roll_width_m);
    const rollLength = nonNegative(
      material?.roll_length_m ?? defaults.roll_length_m,
    );
    const rollCost = nonNegative(material?.roll_cost ?? defaults.roll_cost);
    const categoryItems = items.filter(
      (item) => materialCategory(item.material_category) === category,
    );
    const totalArea = categoryItems.reduce(
      (sum, item) =>
        sum +
        (nonNegative(item.width_mm) *
          nonNegative(item.height_mm) *
          nonNegative(item.quantity)) /
          1_000_000,
      0,
    );
    const totalQuantity = categoryItems.reduce(
      (sum, item) => sum + nonNegative(item.quantity),
      0,
    );
    const manualLinear =
      material?.linear_meters_used === null ||
      material?.linear_meters_used === undefined ||
      material?.linear_meters_used === ""
        ? null
        : nonNegative(material.linear_meters_used);
    const linearMeters =
      manualLinear ?? (rollWidth > 0 ? totalArea / rollWidth : 0);
    const manualRolls =
      material?.required_rolls === null ||
      material?.required_rolls === undefined ||
      material?.required_rolls === ""
        ? null
        : nonNegative(material.required_rolls);
    const requiredRolls =
      manualRolls ??
      (rollLength > 0 ? Math.ceil(linearMeters / rollLength) : 0);
    const allocatedMaterialCost =
      rollLength > 0 ? round((linearMeters * rollCost) / rollLength) : 0;
    const fullRollPurchaseCost = round(requiredRolls * rollCost);
    const netPrintCost = round(totalArea * hpLatexRate);
    const printingWithAllowance = round(netPrintCost * (1 + wasteAllowance));
    return {
      material_category: category,
      display_name: String(
        material?.display_name ?? defaults.display_name ?? category,
      ),
      roll_width_m: round(rollWidth, 4),
      roll_length_m: round(rollLength, 4),
      roll_cost: round(rollCost),
      total_area_sqm: round(totalArea, 6),
      total_quantity: totalQuantity,
      linear_meters_used: round(linearMeters, 4),
      required_rolls: round(requiredRolls, 4),
      allocated_material_cost: allocatedMaterialCost,
      full_roll_purchase_cost: fullRollPurchaseCost,
      net_print_cost: netPrintCost,
      printing_with_allowance: printingWithAllowance,
      consumption_cost: round(allocatedMaterialCost + printingWithAllowance),
      procurement_cost: round(fullRollPurchaseCost + printingWithAllowance),
    };
  });
  const additionalCostRows = (input.additionalCosts ?? []).map((cost) => ({
    label: String(cost.label ?? "Additional cost").trim() || "Additional cost",
    amount: round(nonNegative(cost.amount)),
    note: String(cost.note ?? ""),
  }));
  const totalQuantity = items.reduce(
    (sum, item) => sum + nonNegative(item.quantity),
    0,
  );
  const totalArea = materialRows.reduce((sum, row) => sum + row.total_area_sqm, 0);
  const materialConsumption = materialRows.reduce(
    (sum, row) => sum + row.allocated_material_cost,
    0,
  );
  const fullRollPurchase = materialRows.reduce(
    (sum, row) => sum + row.full_roll_purchase_cost,
    0,
  );
  const netPrintCost = materialRows.reduce(
    (sum, row) => sum + row.net_print_cost,
    0,
  );
  const printingWithAllowance = materialRows.reduce(
    (sum, row) => sum + row.printing_with_allowance,
    0,
  );
  const additionalCosts = additionalCostRows.reduce(
    (sum, row) => sum + row.amount,
    0,
  );
  const directConsumptionCost = round(materialConsumption + printingWithAllowance);
  const directProcurementCost = round(fullRollPurchase + printingWithAllowance);
  const projectCostConsumption = round(directConsumptionCost + additionalCosts);
  const projectCostProcurement = round(directProcurementCost + additionalCosts);
  return {
    formula_version: input.formulaVersion ?? DEFAULT_FORMULA_VERSION,
    hp_latex_rate: round(hpLatexRate, 4),
    waste_allowance: round(wasteAllowance, 6),
    total_quantity: totalQuantity,
    total_area_sqm: round(totalArea, 6),
    material_consumption: round(materialConsumption),
    full_roll_purchase: round(fullRollPurchase),
    net_print_cost: round(netPrintCost),
    printing_with_allowance: round(printingWithAllowance),
    direct_consumption_cost: directConsumptionCost,
    direct_procurement_cost: directProcurementCost,
    additional_costs: round(additionalCosts),
    project_cost_consumption: projectCostConsumption,
    project_cost_procurement: projectCostProcurement,
    cost_per_piece: totalQuantity > 0 ? round(projectCostConsumption / totalQuantity, 4) : 0,
    material_rows: materialRows,
    additional_cost_rows: additionalCostRows,
  };
}
