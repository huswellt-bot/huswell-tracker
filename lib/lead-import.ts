import * as XLSX from "xlsx";

export const MAX_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_ROWS = 1000;
export const LEAD_HEADERS = [
  "Date recorded",
  "Contact Person's Fullname",
  "Company Name",
  "Company Address",
  "Email",
  "Contact Number",
  "Date contacted",
  "Outbound method",
  "Lead status",
] as const;
export const LEAD_TEMPLATE_COLUMN_WIDTHS = [16, 32, 28, 36, 30, 20, 18, 18, 30];
export const CONTACT_METHODS = [
  "Viber",
  "WhatsApp",
  "Messenger",
  "Instagram",
  "Phone Call",
  "Email",
] as const;
export const LEAD_STATUS_LABELS: Record<number, string> = {
  1: "New client",
  2: "Paying / Repeat client",
  3: "Lost client",
  4: "Potential client / Prospect",
  5: "Loyal / Long-term client",
  6: "Inactive / Dormant client",
  8: "Referral client",
  9: "VIP / High-value client",
};

export type ImportField =
  | "date_sent"
  | "contact_name"
  | "client_name"
  | "address"
  | "email"
  | "phone"
  | "date_contacted"
  | "contact_method"
  | "evaluation_number";

export type ImportRow = {
  row_number: number;
  date_sent: string | null;
  contact_name: string;
  client_name: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  date_contacted: string | null;
  contact_method: string | null;
  evaluation_number: number;
};

export type PreviewRow = ImportRow & {
  errors: string[];
  status: "ready" | "duplicate" | "invalid";
};

export type ParseRowsOptions = {
  headerRowIndex?: number;
  headerIndexes?: Map<ImportField, number>;
};

export type ParsedWorkbook = {
  sheetName: string;
  headerRowIndex: number;
  rows: PreviewRow[];
};

const headerAliases: Record<string, ImportField> = {
  daterecorded: "date_sent",
  datesent: "date_sent",
  dateadded: "date_sent",
  datecreated: "date_sent",
  date: "date_sent",
  contactpersonsfullname: "contact_name",
  contactpersonfullname: "contact_name",
  contactpersonname: "contact_name",
  contactname: "contact_name",
  fullname: "contact_name",
  customername: "contact_name",
  name: "contact_name",
  companyname: "client_name",
  clientname: "client_name",
  businessname: "client_name",
  company: "client_name",
  companyaddress: "address",
  businessaddress: "address",
  address: "address",
  email: "email",
  emailaddress: "email",
  mail: "email",
  contactnumber: "phone",
  phone: "phone",
  phonenumber: "phone",
  mobileno: "phone",
  mobilenumber: "phone",
  cellphone: "phone",
  datecontacted: "date_contacted",
  contacteddate: "date_contacted",
  outboundmethod: "contact_method",
  contactmethod: "contact_method",
  channel: "contact_method",
  contactchannel: "contact_method",
  leadstatus: "evaluation_number",
  status: "evaluation_number",
  stage: "evaluation_number",
  leadstage: "evaluation_number",
};

export const compact = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "");

export const textCell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).trim();
};

const nullableText = (value: unknown) => {
  const result = textCell(value);
  return result ? result : null;
};

const dateFromParts = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
};

const normalizeDate = (value: unknown) => {
  if (value === null || value === undefined || textCell(value) === "") {
    return { value: null as string | null };
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, error: "Invalid date" };
    const normalized = dateFromParts(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
    );
    return normalized
      ? { value: normalized }
      : { value: null, error: "Invalid date" };
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return { value: null, error: "Invalid date" };
    const normalized = dateFromParts(parsed.y, parsed.m, parsed.d);
    return normalized
      ? { value: normalized }
      : { value: null, error: "Invalid date" };
  }

  const raw = textCell(value);
  const yearFirst = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (yearFirst) {
    const normalized = dateFromParts(
      Number(yearFirst[1]),
      Number(yearFirst[2]),
      Number(yearFirst[3]),
    );
    return normalized
      ? { value: normalized }
      : { value: null, error: "Invalid date" };
  }

  const monthFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (monthFirst) {
    const normalized = dateFromParts(
      Number(monthFirst[3]),
      Number(monthFirst[1]),
      Number(monthFirst[2]),
    );
    return normalized
      ? { value: normalized }
      : { value: null, error: "Invalid date" };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { value: null, error: "Invalid date" };
  const normalized = dateFromParts(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    parsed.getUTCDate(),
  );
  return normalized
    ? { value: normalized }
    : { value: null, error: "Invalid date" };
};

const normalizeContactMethod = (value: unknown) => {
  const raw = compact(value);
  if (!raw) return { value: null as string | null };
  const match = CONTACT_METHODS.find((method) => compact(method) === raw);
  return match
    ? { value: match }
    : { value: null, error: `Unknown outbound method "${textCell(value)}"` };
};

const normalizeStatus = (value: unknown) => {
  const raw = textCell(value);
  if (!raw) return { value: 4 };

  const idCandidate = raw.split("|")[0].trim();
  if (/^\d+$/.test(idCandidate)) {
    const id = Number(idCandidate);
    if (id === 7) return { value: 4, error: "Done Deal rows cannot be imported as Leads" };
    if (LEAD_STATUS_LABELS[id]) return { value: id };
  }

  const match = Object.entries(LEAD_STATUS_LABELS).find(
    ([, label]) => compact(label) === compact(raw),
  );
  if (match) return { value: Number(match[0]) };
  if (compact(raw).includes("donedeal")) {
    return { value: 4, error: "Done Deal rows cannot be imported as Leads" };
  }
  return { value: 4, error: `Unknown lead status "${raw}"` };
};

export const getHeaderIndexes = (headerRow: unknown[]) => {
  const indexes = new Map<ImportField, number>();
  headerRow.forEach((cell, index) => {
    const field = headerAliases[compact(cell)];
    if (field && !indexes.has(field)) indexes.set(field, index);
  });
  return indexes;
};

export const getSheetRows = (sheet: XLSX.WorkSheet) =>
  XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });

const findHeaderRowIndex = (rows: unknown[][]) => {
  let bestIndex = 0;
  let bestScore = -1;
  const maxSearchRows = Math.min(rows.length, 25);
  for (let index = 0; index < maxSearchRows; index += 1) {
    const matches = getHeaderIndexes(rows[index] ?? []);
    const score = matches.size + (matches.has("contact_name") ? 4 : 0);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
};

export const parseRows = (
  sheet: XLSX.WorkSheet,
  options: ParseRowsOptions = {},
) => {
  const rows = getSheetRows(sheet);
  const headerRowIndex = Math.max(
    0,
    Math.min(options.headerRowIndex ?? findHeaderRowIndex(rows), Math.max(rows.length - 1, 0)),
  );
  const headerRow = rows[headerRowIndex] ?? [];
  const indexes = options.headerIndexes ?? getHeaderIndexes(headerRow);
  if (!indexes.has("contact_name")) {
    throw new Error(
      "The Excel file must include a Contact Person's Fullname column. Download the template or use a supported column name.",
    );
  }

  const dataRows = rows
    .slice(headerRowIndex + 1)
    .map((row, index) => ({ row, rowNumber: headerRowIndex + index + 2 }))
    .filter(({ row }) => row.some((cell) => textCell(cell) !== ""));
  if (dataRows.length > MAX_ROWS) {
    throw new Error(`The Excel file may contain at most ${MAX_ROWS} non-empty rows.`);
  }

  return dataRows.map(({ row, rowNumber }) => {
    const cell = (field: ImportField) =>
      indexes.has(field) ? row[indexes.get(field) ?? -1] : "";
    const errors: string[] = [];
    const contactName = textCell(cell("contact_name"));
    const clientName = nullableText(cell("client_name"));
    const address = nullableText(cell("address"));
    const emailRaw = nullableText(cell("email"));
    const phone = nullableText(cell("phone"));
    const dateSent = normalizeDate(cell("date_sent"));
    const dateContacted = normalizeDate(cell("date_contacted"));
    const contactMethod = normalizeContactMethod(cell("contact_method"));
    const evaluationNumber = normalizeStatus(cell("evaluation_number"));

    if (!contactName) errors.push("Contact Person's Fullname is required");
    if (contactName.length > 255) errors.push("Contact name is too long");
    if (clientName && clientName.length > 1000) errors.push("Company name is too long");
    if (address && address.length > 4000) errors.push("Company address is too long");
    if (emailRaw && !/^\S+@\S+\.\S+$/.test(emailRaw)) {
      errors.push("Email address is invalid");
    }
    if (emailRaw && emailRaw.length > 254) errors.push("Email address is too long");
    if (phone && phone.length > 100) errors.push("Contact number is too long");
    if (dateSent.error) errors.push(`Date recorded: ${dateSent.error.toLowerCase()}`);
    if (dateContacted.error) errors.push(`Date contacted: ${dateContacted.error.toLowerCase()}`);
    if (contactMethod.error) errors.push(contactMethod.error);
    if (evaluationNumber.error) errors.push(evaluationNumber.error);

    return {
      row_number: rowNumber,
      date_sent: dateSent.value,
      contact_name: contactName,
      client_name: clientName,
      address,
      email: emailRaw?.toLowerCase() ?? null,
      phone,
      date_contacted: dateContacted.value,
      contact_method: contactMethod.value,
      evaluation_number: evaluationNumber.value,
      errors,
      status: errors.length ? "invalid" as const : "ready" as const,
    };
  });
};

export const parseWorkbook = (
  workbook: XLSX.WorkBook,
  options: {
    sheetName?: string;
    headerRowIndex?: number;
    headerIndexes?: Map<ImportField, number>;
  } = {},
): ParsedWorkbook => {
  const sheetName = options.sheetName ?? workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw new Error("The Excel file has no worksheet.");
  }
  const rows = getSheetRows(workbook.Sheets[sheetName]);
  const headerRowIndex = options.headerRowIndex ?? findHeaderRowIndex(rows);
  return {
    sheetName,
    headerRowIndex,
    rows: parseRows(workbook.Sheets[sheetName], {
      headerIndexes: options.headerIndexes,
      headerRowIndex,
    }),
  };
};

export const importRows = (rows: PreviewRow[]): ImportRow[] =>
  rows
    .filter((row) => row.status !== "invalid")
    .map((row) => ({
      row_number: row.row_number,
      date_sent: row.date_sent,
      contact_name: row.contact_name,
      client_name: row.client_name,
      address: row.address,
      email: row.email,
      phone: row.phone,
      date_contacted: row.date_contacted,
      contact_method: row.contact_method,
      evaluation_number: row.evaluation_number,
    }));
