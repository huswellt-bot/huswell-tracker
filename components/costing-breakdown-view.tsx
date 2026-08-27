import Link from "next/link";

type Row = Record<string, unknown>;

const text = (value: unknown, fallback = "—") =>
  value === null || value === undefined || value === ""
    ? fallback
    : String(value);
const number = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});
const day = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf())
    ? String(value)
    : new Intl.DateTimeFormat("en-PH", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
};

export function CostingBreakdownView({
  costing,
  lead,
  lines,
  backHref,
}: {
  costing: Row;
  lead: Row | null;
  lines: Row[];
  backHref: string;
}) {
  const clientName = text(
    lead?.contact_name ?? costing.client_contact_name,
  );
  const companyName = text(
    lead?.client_name ?? costing.client_name ?? costing.project_name,
  );
  const totalCost = lines.reduce(
    (total, line) => total + number(line.line_total),
    0,
  );

  return (
    <main className="min-h-screen bg-[#f6f8fc] p-4 text-[#202938] sm:p-7">
      <section className="mx-auto w-full max-w-6xl overflow-hidden rounded-[14px] border border-[#dfe5ed] bg-white shadow-sm">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e9edf2] px-5 py-4 sm:px-7">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8b92a1]">
              Costing Breakdown
            </p>
            <h1 className="mt-1 text-[20px] font-semibold text-[#202938]">
              {text(costing.quotation_no)}
            </h1>
            <p className="mt-1 text-[13px] text-[#687386]">
              {text(costing.project_name)} · {day(costing.issue_date)}
            </p>
          </div>
          <Link
            href={backHref}
            className="rounded-lg border border-[#d9e0e9] px-3 py-2 text-[13px] font-medium text-[#344054] transition hover:bg-[#f6f8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c43b43] focus-visible:ring-offset-2"
          >
            Back to workspace
          </Link>
        </header>

        <div className="grid gap-4 border-b border-[#e9edf2] px-5 py-4 text-[13px] sm:grid-cols-2 sm:px-7 lg:grid-cols-4">
          <div>
            <span className="block text-[11px] text-[#8b92a1]">Client name</span>
            <span>{clientName}</span>
          </div>
          <div>
            <span className="block text-[11px] text-[#8b92a1]">Company name</span>
            <span>{companyName}</span>
          </div>
          <div>
            <span className="block text-[11px] text-[#8b92a1]">Phone / email</span>
            <span>{text(costing.client_phone)}</span>
          </div>
          <div>
            <span className="block text-[11px] text-[#8b92a1]">Status</span>
            <span className="capitalize">{text(costing.status).replaceAll("_", " ")}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="border-b border-[#e9edf2] bg-[#f8faff] text-[11px] font-medium uppercase tracking-[0.04em] text-[#687386]">
              <tr>
                <th className="px-5 py-3 sm:px-7">Material / production cost</th>
                <th className="px-5 py-3 text-center">Quantity</th>
                <th className="px-5 py-3 text-right">Unit cost</th>
                <th className="px-5 py-3 text-right sm:px-7">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f5]">
              {lines.map((line) => (
                <tr key={text(line.id, `${line.description}-${line.sort_order}`)}>
                  <td className="px-5 py-3 text-[#344054] sm:px-7">
                    <span className="block">{text(line.description)}</span>
                    {text(line.details, "") && (
                      <span className="mt-1 block whitespace-pre-line text-[12px] text-[#687386]">
                        {text(line.details)}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-center tabular-nums">
                    {number(line.quantity)}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {peso.format(number(line.unit_cost))}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums sm:px-7">
                    {peso.format(number(line.line_total))}
                  </td>
                </tr>
              ))}
              {!lines.length && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-[#687386]">
                    No costing lines were added.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t border-[#dfe5ed] bg-[#f8faff]">
              <tr>
                <td colSpan={3} className="px-5 py-4 text-right font-medium text-[#344054] sm:px-7">
                  Total Estimated COGS
                </td>
                <td className="px-5 py-4 text-right font-medium tabular-nums text-[#202938] sm:px-7">
                  {peso.format(totalCost || number(costing.total_cost))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </main>
  );
}
