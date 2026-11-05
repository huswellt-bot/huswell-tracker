export type LeadCostingUnit = "ft" | "in" | "m" | "px";
export type LeadCostingLamination = "none" | "matte" | "glossy";

export type LeadCostingMaterial = {
  roll_width_m: number | null;
  roll_length_m: number | null;
  is_sheet?: boolean | null;
  is_finishing?: boolean | null;
  is_active?: boolean | null;
};

export type LeadCostingPrinterRateRow = {
  item: string;
  cost_per_unit: number | null | undefined;
};

export type LeadCostingInventory = {
  full_rolls_on_hand?: number | null;
  remaining_meters?: number | null;
  available_sheets?: number | null;
};

export type LeadCostingProductionReadiness = {
  ready: boolean;
  manualConfirmationAllowed: boolean;
  reason: string;
};

export type LeadCostingCalculatorInput = {
  width: string | number;
  height: string | number;
  quantity: string | number;
  unit: LeadCostingUnit;
  dpi: string | number;
  mediaRate: string | number;
  inkRate: string | number;
  wasteRate: string | number;
  lamination: LeadCostingLamination;
};

export type LeadCostingLayoutPlan = {
  valid: boolean;
  reason: string;
  printedArea: number;
  usedArea: number;
  lengthM: number;
  wastePercent: number;
  costAllowancePercent: number;
  across: number;
  rows: number;
  rollWidthM: number;
  rollLengthM: number;
};

export type LeadCostingCalculation = LeadCostingLayoutPlan & {
  valid: boolean;
  layoutValid: boolean;
  width: number;
  height: number;
  quantity: number;
  areaPerItem: number;
  areaM2PerItem: number;
  printedAreaM2: number;
  requiredLength: number;
  rollLength: number;
  mediaPerItem: number;
  wastePerItem: number;
  wasteProject: number;
  inkPerItem: number;
  laminationPerItem: number;
  totalCostPerItem: number;
  totalOrderCost: number;
  stockFit: string;
};

export const numberValue = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const areaFactor = (unit: LeadCostingUnit) =>
  unit === "m" || unit === "px" ? 1 : unit === "in" ? 1550.0031 : 10.7639104167;

export const unitLabel = (unit: LeadCostingUnit) =>
  unit === "m" || unit === "px" ? "m²" : unit === "in" ? "sq in" : "sq ft";

export const DEFAULT_PRINT_COST_PER_SQ_FT = 9.27;
const SQ_FT_TO_M2 = 10.7639104167;

export const printCostBasePerSqFt = (rows: LeadCostingPrinterRateRow[]) => {
  const perSqFt = rows.find((row) => row.item === "Average total print cost / sq ft")?.cost_per_unit;
  if (perSqFt != null) return numberValue(perSqFt);
  const perM2 = rows.find((row) => row.item === "Average total print cost / m²")?.cost_per_unit;
  if (perM2 != null) return numberValue(perM2) / SQ_FT_TO_M2;
  const perSqIn = rows.find((row) => row.item === "Average total print cost / sq in")?.cost_per_unit;
  return perSqIn == null ? DEFAULT_PRINT_COST_PER_SQ_FT : numberValue(perSqIn) * 144;
};

export const printCostRateForUnit = (rows: LeadCostingPrinterRateRow[], unit: LeadCostingUnit) => {
  const basePerSqFt = printCostBasePerSqFt(rows);
  return unit === "ft" ? basePerSqFt : unit === "in" ? basePerSqFt / 144 : basePerSqFt * SQ_FT_TO_M2;
};

export const isPrintableLeadCostingMaterial = (material: LeadCostingMaterial | undefined) =>
  Boolean(material) && material?.is_active !== false && material?.is_finishing !== true;

export const calculateLayoutPlan = (
  input: Pick<LeadCostingCalculatorInput, "width" | "height" | "quantity" | "unit" | "dpi">,
  material: LeadCostingMaterial | undefined,
): LeadCostingLayoutPlan => {
  const width = Math.max(0, numberValue(input.width));
  const height = Math.max(0, numberValue(input.height));
  const quantity = Math.max(1, Math.floor(numberValue(input.quantity) || 1));
  const factor = input.unit === "ft" ? 0.3048 : input.unit === "in" ? 0.0254 : input.unit === "px" ? 0.0254 / Math.max(1, numberValue(input.dpi) || 300) : 1;
  const widthM = width * factor;
  const heightM = height * factor;
  const rollWidth = numberValue(material?.roll_width_m);
  const rollLength = numberValue(material?.roll_length_m);
  const printedArea = widthM * heightM * quantity;

  if (!rollWidth || !rollLength || widthM <= 0 || heightM <= 0 || quantity < 1) {
    return {
      valid: false,
      reason: "Enter valid dimensions and select a material with known roll dimensions.",
      printedArea,
      usedArea: 0,
      lengthM: 0,
      wastePercent: 0,
      costAllowancePercent: 0,
      across: 0,
      rows: 0,
      rollWidthM: rollWidth,
      rollLengthM: rollLength,
    };
  }

  const candidates = [
    [widthM, heightM],
    [heightM, widthM],
  ]
    .map(([acrossWidth, alongLength]) => {
      const across = Math.floor((rollWidth + 0.000000001) / acrossWidth);
      if (across < 1) return null;
      const rows = Math.ceil(quantity / across);
      const lengthM = rows * alongLength;
      const usedArea = rollWidth * lengthM;
      const wasteArea = Math.max(0, usedArea - printedArea);
      return {
        valid: true,
        reason: "",
        printedArea,
        usedArea,
        lengthM,
        wastePercent: usedArea > 0 ? (wasteArea / usedArea) * 100 : 0,
        costAllowancePercent: printedArea > 0 ? (wasteArea / printedArea) * 100 : 0,
        across,
        rows,
        rollWidthM: rollWidth,
        rollLengthM: rollLength,
      } as LeadCostingLayoutPlan;
    })
    .filter((candidate): candidate is LeadCostingLayoutPlan => candidate !== null && candidate.lengthM <= rollLength + 0.000000001);

  if (!candidates.length) {
    return {
      valid: false,
      reason: `Job does not fit the selected roll width (${rollWidth} m) and length (${rollLength} m).`,
      printedArea,
      usedArea: 0,
      lengthM: 0,
      wastePercent: 0,
      costAllowancePercent: 0,
      across: 0,
      rows: 0,
      rollWidthM: rollWidth,
      rollLengthM: rollLength,
    };
  }

  return candidates.sort((left, right) => left.lengthM - right.lengthM)[0];
};

export const calculateStockFit = ({
  input,
  material,
  fullRolls,
  remainingMeters,
  availableSheets,
}: {
  input: Pick<LeadCostingCalculatorInput, "width" | "height" | "quantity" | "unit" | "dpi">;
  material: LeadCostingMaterial | undefined;
  fullRolls: string | number | null | undefined;
  remainingMeters: string | number | null | undefined;
  availableSheets?: string | number | null | undefined;
}) => {
  const plan = calculateLayoutPlan(input, material);
  if (material?.is_sheet) {
    const hasSheetInventory = availableSheets != null;
    const requiredSheets = plan.valid ? Math.ceil(Math.max(1, numberValue(input.quantity)) / Math.max(1, plan.across)) : 0;
    return {
      plan,
      requiredLength: 0,
      requiredRolls: 0,
      availableMeters: null as number | null,
      availableSheets: hasSheetInventory ? numberValue(availableSheets) : null,
      requiredSheets,
      status: hasSheetInventory
        ? plan.valid
          ? numberValue(availableSheets) + 0.0001 >= requiredSheets
            ? `Enough stock: ${numberValue(availableSheets).toFixed(0)} sheet${numberValue(availableSheets) === 1 ? "" : "s"} available`
            : `Short by ${(requiredSheets - numberValue(availableSheets)).toFixed(0)} sheet${requiredSheets - numberValue(availableSheets) === 1 ? "" : "s"}`
          : `${numberValue(availableSheets).toFixed(0)} sheet${numberValue(availableSheets) === 1 ? "" : "s"} recorded; confirm sheet fit manually`
        : "Enter available sheets",
    };
  }
  if (!plan.rollWidthM || !plan.rollLengthM) {
    return {
      plan,
      requiredLength: 0,
      requiredRolls: 0,
      availableMeters: null as number | null,
      availableSheets: null as number | null,
      requiredSheets: 0,
      status: "Roll dimensions unavailable",
    };
  }
  if (!plan.valid) {
    return {
      plan,
      requiredLength: 0,
      requiredRolls: 0,
      availableMeters: null as number | null,
      availableSheets: null as number | null,
      requiredSheets: 0,
      status: plan.reason,
    };
  }

  const requiredLength = plan.lengthM * 1.1;
  const requiredRolls = Math.ceil(requiredLength / plan.rollLengthM);
  const hasInventory = fullRolls != null || remainingMeters != null;
  const availableMeters = hasInventory
    ? numberValue(fullRolls) * plan.rollLengthM + numberValue(remainingMeters)
    : null;

  return {
    plan,
    requiredLength,
    requiredRolls,
    availableMeters,
    availableSheets: null as number | null,
    requiredSheets: 0,
    status:
      availableMeters == null
        ? "Enter roll count or remaining meters"
        : availableMeters + 0.0001 >= requiredLength
          ? `Enough stock: ${(availableMeters - requiredLength).toFixed(2)} m remaining after estimated job`
          : `Short by ${(requiredLength - availableMeters).toFixed(2)} m`,
  };
};

export const calculateProductionReadiness = (
  input: Pick<LeadCostingCalculatorInput, "width" | "height" | "quantity" | "unit" | "dpi">,
  material: LeadCostingMaterial | undefined,
  inventory?: LeadCostingInventory,
): LeadCostingProductionReadiness => {
  if (!isPrintableLeadCostingMaterial(material)) {
    return { ready: false, manualConfirmationAllowed: false, reason: "Select an active printable material." };
  }
  if (input.unit === "px" && numberValue(input.dpi) <= 0) {
    return { ready: false, manualConfirmationAllowed: false, reason: "Enter a positive DPI for pixel dimensions." };
  }

  const stockFit = calculateStockFit({
    input,
    material,
    fullRolls: inventory?.full_rolls_on_hand,
    remainingMeters: inventory?.remaining_meters,
    availableSheets: inventory?.available_sheets,
  });

  if (material?.is_sheet) {
    if (stockFit.availableSheets == null) {
      return { ready: false, manualConfirmationAllowed: false, reason: "Enter available sheets in Material Inventory before submitting." };
    }
    if (stockFit.availableSheets <= 0) {
      return { ready: false, manualConfirmationAllowed: false, reason: "No sheet stock is available for this material." };
    }
    if (!stockFit.plan.valid) {
      if (!numberValue(material.roll_width_m) || !numberValue(material.roll_length_m)) {
        return { ready: false, manualConfirmationAllowed: true, reason: "Sheet dimensions are not configured; confirm the available sheet stock manually." };
      }
      return { ready: false, manualConfirmationAllowed: false, reason: stockFit.plan.reason };
    }
    if (stockFit.requiredSheets > stockFit.availableSheets) {
      return { ready: false, manualConfirmationAllowed: false, reason: stockFit.status };
    }
    return { ready: true, manualConfirmationAllowed: false, reason: stockFit.status };
  }

  if (!stockFit.plan.valid) {
    return { ready: false, manualConfirmationAllowed: false, reason: stockFit.plan.reason };
  }
  if (stockFit.availableMeters == null) {
    return { ready: false, manualConfirmationAllowed: false, reason: "Enter full rolls or remaining meters in Material Inventory before submitting." };
  }
  if (stockFit.availableMeters + 0.0001 < stockFit.requiredLength) {
    return { ready: false, manualConfirmationAllowed: false, reason: stockFit.status };
  }
  return { ready: true, manualConfirmationAllowed: false, reason: stockFit.status };
};

export const calculateLeadCosting = (
  input: LeadCostingCalculatorInput,
  material: LeadCostingMaterial | undefined,
): LeadCostingCalculation => {
  const width = Math.max(0, numberValue(input.width));
  const height = Math.max(0, numberValue(input.height));
  const quantity = Math.max(1, Math.floor(numberValue(input.quantity) || 1));
  const factor = input.unit === "ft" ? 0.3048 : input.unit === "in" ? 0.0254 : input.unit === "px" ? 0.0254 / Math.max(1, numberValue(input.dpi) || 300) : 1;
  const widthM = width * factor;
  const heightM = height * factor;
  const areaPerItem = width * height;
  const areaM2PerItem = widthM * heightM;
  const layout = calculateLayoutPlan(input, material);
  const rateArea = input.unit === "px" ? areaM2PerItem : areaPerItem;
  const mediaPerItem = rateArea * Math.max(0, numberValue(input.mediaRate));
  const inkPerItem = rateArea * Math.max(0, numberValue(input.inkRate));
  const areaIn2 = (widthM / 0.0254) * (heightM / 0.0254);
  const laminationPerItem =
    areaIn2 *
    (input.lamination === "matte"
      ? 0.008
      : input.lamination === "glossy"
        ? 0.0755
        : 0);
  const wasteProject = Math.max(0, numberValue(input.wasteRate));
  const wastePerItem = wasteProject / quantity;
  const totalCostPerItem = mediaPerItem + wastePerItem + inkPerItem + laminationPerItem;
  const totalOrderCost = totalCostPerItem * quantity;
  const numericInputsAreValid = [input.width, input.height, input.quantity, input.mediaRate, input.inkRate, input.wasteRate]
    .every((value) => String(value ?? "").trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0);
  const quantityIsValid = Number.isInteger(Number(input.quantity)) && Number(input.quantity) > 0;

  return {
    ...layout,
    valid: width > 0 && height > 0 && quantityIsValid && numericInputsAreValid && isPrintableLeadCostingMaterial(material) && (input.unit !== "px" || numberValue(input.dpi) > 0),
    layoutValid: layout.valid,
    width,
    height,
    quantity,
    areaPerItem,
    areaM2PerItem,
    printedAreaM2: areaM2PerItem * quantity,
    requiredLength: layout.lengthM,
    rollLength: numberValue(material?.roll_length_m),
    mediaPerItem,
    wastePerItem,
    wasteProject,
    inkPerItem,
    laminationPerItem,
    totalCostPerItem,
    totalOrderCost,
    stockFit: layout.valid ? "Calculated" : layout.reason,
  };
};
