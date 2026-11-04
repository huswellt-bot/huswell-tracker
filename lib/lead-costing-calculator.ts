export type LeadCostingUnit = "ft" | "in" | "m" | "px";
export type LeadCostingLamination = "none" | "matte" | "glossy";

export type LeadCostingMaterial = {
  roll_width_m: number | null;
  roll_length_m: number | null;
  is_sheet?: boolean | null;
};

export type LeadCostingCalculatorInput = {
  width: string | number;
  height: string | number;
  quantity: string | number;
  unit: LeadCostingUnit;
  mediaRate: string | number;
  inkRate: string | number;
  wasteRate: string | number;
  lamination: LeadCostingLamination;
  amountPaid: string | number;
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
  amountPaid: number;
  balance: number;
  paymentStatus: "Unpaid" | "Partially paid" | "Paid in full";
  stockFit: string;
};

export const numberValue = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const areaFactor = (unit: LeadCostingUnit) =>
  unit === "m" ? 1 : unit === "in" ? 1550.0031 : unit === "px" ? 0 : 10.7639104167;

export const unitLabel = (unit: LeadCostingUnit) =>
  unit === "m" ? "m²" : unit === "in" ? "sq in" : unit === "px" ? "px" : "sq ft";

export const calculateLayoutPlan = (
  input: Pick<LeadCostingCalculatorInput, "width" | "height" | "quantity" | "unit">,
  material: LeadCostingMaterial | undefined,
): LeadCostingLayoutPlan => {
  const width = Math.max(0, numberValue(input.width));
  const height = Math.max(0, numberValue(input.height));
  const quantity = Math.max(1, Math.floor(numberValue(input.quantity) || 1));
  const factor = input.unit === "ft" ? 0.3048 : input.unit === "in" ? 0.0254 : input.unit === "px" ? 0 : 1;
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
    .filter((candidate): candidate is LeadCostingLayoutPlan => candidate !== null);

  if (!candidates.length) {
    return {
      valid: false,
      reason: `Job does not fit the selected roll width (${rollWidth} m) in either orientation.`,
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
}: {
  input: Pick<LeadCostingCalculatorInput, "width" | "height" | "quantity" | "unit">;
  material: LeadCostingMaterial | undefined;
  fullRolls: string | number | null | undefined;
  remainingMeters: string | number | null | undefined;
}) => {
  const plan = calculateLayoutPlan(input, material);
  if (!plan.rollWidthM || !plan.rollLengthM) {
    return {
      plan,
      requiredLength: 0,
      requiredRolls: 0,
      availableMeters: null as number | null,
      status: "Roll dimensions unavailable",
    };
  }
  if (!plan.valid) {
    return {
      plan,
      requiredLength: 0,
      requiredRolls: 0,
      availableMeters: null as number | null,
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
    status:
      availableMeters == null
        ? "Enter roll count or remaining meters"
        : availableMeters + 0.0001 >= requiredLength
          ? `Enough stock: ${(availableMeters - requiredLength).toFixed(2)} m remaining after estimated job`
          : `Short by ${(requiredLength - availableMeters).toFixed(2)} m`,
  };
};

export const calculateLeadCosting = (
  input: LeadCostingCalculatorInput,
  material: LeadCostingMaterial | undefined,
): LeadCostingCalculation => {
  const width = Math.max(0, numberValue(input.width));
  const height = Math.max(0, numberValue(input.height));
  const quantity = Math.max(1, Math.floor(numberValue(input.quantity) || 1));
  const factor = input.unit === "ft" ? 0.3048 : input.unit === "in" ? 0.0254 : input.unit === "px" ? 0 : 1;
  const widthM = width * factor;
  const heightM = height * factor;
  const areaPerItem = width * height;
  const areaM2PerItem = widthM * heightM;
  const layout = calculateLayoutPlan(input, material);
  const mediaPerItem = areaPerItem * Math.max(0, numberValue(input.mediaRate));
  const inkPerItem = areaPerItem * Math.max(0, numberValue(input.inkRate));
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
  const amountPaid = Math.min(totalOrderCost, Math.max(0, numberValue(input.amountPaid)));
  const balance = Math.max(0, totalOrderCost - amountPaid);

  return {
    ...layout,
    valid: input.unit !== "px" && width > 0 && height > 0 && Boolean(material),
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
    amountPaid,
    balance,
    paymentStatus:
      balance <= 0.009 ? "Paid in full" : amountPaid > 0 ? "Partially paid" : "Unpaid",
    stockFit: layout.valid ? "Calculated" : layout.reason,
  };
};
