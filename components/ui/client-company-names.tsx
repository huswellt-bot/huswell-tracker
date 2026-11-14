type ClientCompanyNamesProps = {
  clientName?: unknown;
  companyName?: unknown;
  className?: string;
  emptyLabel?: string;
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
}: ClientCompanyNamesProps) {
  const client = normalizePartyName(clientName);
  const company = normalizePartyName(companyName);
  const names = [client, company].filter((name, index, values) =>
    Boolean(name)
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
