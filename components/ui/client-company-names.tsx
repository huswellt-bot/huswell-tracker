type ClientCompanyNamesProps = {
  clientName?: unknown;
  companyName?: unknown;
  className?: string;
  emptyLabel?: string;
  excludeNames?: unknown[];
};

type ProjectIdentityProps = {
  projectName?: unknown;
  clientName?: unknown;
  companyName?: unknown;
  customerName?: unknown;
  className?: string;
  projectClassName?: string;
  partyClassName?: string;
  emptyProjectLabel?: string;
};

const normalizePartyName = (value: unknown) => {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized && !["-", "—", "â€”"].includes(normalized)
    ? normalized
    : "";
};

export function ClientCompanyNames({
  clientName,
  companyName,
  className,
  emptyLabel = "—",
  excludeNames = [],
}: ClientCompanyNamesProps) {
  const client = normalizePartyName(clientName);
  const company = normalizePartyName(companyName);
  const excludedNames = new Set(
    excludeNames
      .map(normalizePartyName)
      .filter(Boolean)
      .map((name) => name.toLowerCase()),
  );
  const names = [client, company].filter((name, index, values) =>
    Boolean(name)
    && !excludedNames.has(name.toLowerCase())
    && values.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index,
  );

  if (!names.length) return <span className={className}>{emptyLabel}</span>;

  return (
    <span className={className}>
      {names.map((name, index) => (
        <span key={`${index}-${name}`} className="block">
          {name}
        </span>
      ))}
    </span>
  );
}

export function ProjectIdentity({
  projectName,
  clientName,
  companyName,
  customerName,
  className,
  projectClassName = "block font-medium",
  partyClassName = "block text-[var(--color-text-secondary)]",
  emptyProjectLabel = "—",
}: ProjectIdentityProps) {
  const project = normalizePartyName(projectName);
  const partyNames = [clientName, companyName, customerName]
    .map(normalizePartyName)
    .filter((name, index, values) => Boolean(name) && values.findIndex((candidate) => candidate.toLowerCase() === name.toLowerCase()) === index);
  const primary = project || partyNames.shift() || emptyProjectLabel;
  const primaryKey = primary.toLowerCase();
  const secondaryNames = partyNames.filter((name) => name.toLowerCase() !== primaryKey);

  return (
    <span className={className}>
      <span className={`block ${projectClassName}`}>{primary}</span>
      {secondaryNames.length > 0 && <span className={`block ${partyClassName}`}>{secondaryNames.join(" · ")}</span>}
    </span>
  );
}
