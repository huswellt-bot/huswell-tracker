export type ProjectOptionLabelParts = {
  quotationNumber?: unknown;
  projectName?: unknown;
  companyName?: unknown;
  clientName?: unknown;
  fallback?: string;
};

const placeholderParts = new Set([
  "",
  "-",
  "—",
  "client",
  "client not set",
  "company not set",
  "name / company not set",
  "no client",
  "no company",
  "project",
  "unnamed project",
  "untitled project",
]);

const normalizePart = (value: unknown) => {
  if (value === null || value === undefined) return "";
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return placeholderParts.has(normalized.toLowerCase()) ? "" : normalized;
};

export const uniqueProjectOptionParts = (values: unknown[]) => {
  const seen = new Set<string>();
  return values.reduce<string[]>((parts, value) => {
    const normalized = normalizePart(value);
    const key = normalized.toLowerCase();
    if (!key || seen.has(key)) return parts;
    seen.add(key);
    parts.push(normalized);
    return parts;
  }, []);
};

export const formatProjectOptionLabel = ({
  quotationNumber,
  projectName,
  companyName,
  clientName,
  fallback = "Project",
}: ProjectOptionLabelParts) =>
  uniqueProjectOptionParts([quotationNumber, projectName, companyName, clientName]).join(" \u00b7 ") || fallback;
