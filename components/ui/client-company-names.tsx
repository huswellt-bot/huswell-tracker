type ClientCompanyNamesProps = {
  clientName?: unknown;
  companyName?: unknown;
  className?: string;
  emptyLabel?: string;
  excludeNames?: unknown[];
};

const normalizePartyName = (value: unknown) => {
  const normalized = String(value ?? "").trim();
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
