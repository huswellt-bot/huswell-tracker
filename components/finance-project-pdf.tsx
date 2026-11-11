import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

type PdfRow = Record<string, unknown>;

const styles = StyleSheet.create({
  page: {
    padding: 34,
    fontSize: 9,
    color: "#17202a",
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 9,
    color: "#64707d",
    marginBottom: 18,
  },
  section: {
    marginBottom: 14,
    border: "1 solid #d9dee5",
    padding: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
  },
  grid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metric: {
    width: "31%",
    border: "1 solid #e4e7eb",
    padding: 7,
  },
  label: {
    fontSize: 7,
    color: "#64707d",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  value: {
    fontSize: 11,
    fontWeight: 700,
  },
  row: {
    display: "flex",
    flexDirection: "row",
    borderBottom: "1 solid #edf0f3",
    paddingVertical: 5,
  },
  cell: {
    flex: 1,
    paddingRight: 5,
  },
  headCell: {
    flex: 1,
    paddingRight: 5,
    fontSize: 7,
    color: "#64707d",
    fontWeight: 700,
    textTransform: "uppercase",
  },
  small: {
    fontSize: 8,
  },
});

const text = (value: unknown, fallback = "—") => {
  const result = String(value ?? "").trim();
  return result || fallback;
};

const amount = (value: unknown) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);

const dateLabel = (value: unknown) => {
  const raw = text(value, "");
  if (!raw) return "—";
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + "T00:00:00" : raw);
  return Number.isNaN(parsed.getTime())
    ? raw.slice(0, 10)
    : new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(parsed);
};

const activityLabel = (activity: PdfRow) => {
  if (text(activity.transaction_kind) === "commission_payout") {
    return "Commission payout" + (text(activity.commission_recipient_name, "") ? " · " + text(activity.commission_recipient_name, "") : "");
  }
  return text(activity.transaction_kind).replaceAll("_", " ");
};

export function FinanceProjectPdf({
  project,
  costingLines,
  activities,
}: {
  project: PdfRow;
  costingLines: PdfRow[];
  activities: PdfRow[];
}) {
  return (
    <Document title={"Project Finance - " + text(project.project_name)}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Project Finance Monitoring</Text>
        <Text style={styles.subtitle}>
          Generated {dateLabel(new Date().toISOString())} · Accounting & Finance ledger
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{text(project.project_name)}</Text>
          <View style={styles.grid}>
            <View style={styles.metric}>
              <Text style={styles.label}>Client</Text>
              <Text style={styles.value}>{text(project.client_name)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.label}>Company</Text>
              <Text style={styles.value}>{text(project.company_name)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.label}>Quotation</Text>
              <Text style={styles.value}>{text(project.quotation_number)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Financial totals</Text>
          <View style={styles.grid}>
            <View style={styles.metric}><Text style={styles.label}>Total quotation</Text><Text style={styles.value}>{amount(project.total_quotation)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Total direct cost</Text><Text style={styles.value}>{amount(project.total_direct_cost)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Client Cash In</Text><Text style={styles.value}>{amount(project.client_cash_in)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Project Cash Out</Text><Text style={styles.value}>{amount(project.cash_out)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Commission total</Text><Text style={styles.value}>{amount(project.commission_total)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Commission paid</Text><Text style={styles.value}>{amount(project.commission_paid)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Commission remaining</Text><Text style={styles.value}>{amount(project.commission_remaining)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Working Fund support</Text><Text style={styles.value}>{amount(project.working_fund_support)}</Text></View>
            <View style={styles.metric}><Text style={styles.label}>Available balance</Text><Text style={styles.value}>{amount(project.available_balance)}</Text></View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Costing breakdown</Text>
          <View style={styles.row}>
            <Text style={styles.headCell}>Description</Text>
            <Text style={styles.headCell}>Qty</Text>
            <Text style={styles.headCell}>Unit cost</Text>
            <Text style={styles.headCell}>Total</Text>
          </View>
          {costingLines.length ? costingLines.map((line) => (
            <View style={styles.row} key={text(line.line_id)}>
              <Text style={styles.cell}>{text(line.description)}</Text>
              <Text style={styles.cell}>{text(line.quantity)}</Text>
              <Text style={styles.cell}>{amount(line.unit_cost)}</Text>
              <Text style={styles.cell}>{amount(line.line_total)}</Text>
            </View>
          )) : <Text style={styles.small}>No costing lines are available for this quotation.</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cash In and Cash Out activity</Text>
          <View style={styles.row}>
            <Text style={styles.headCell}>Date</Text>
            <Text style={styles.headCell}>Activity</Text>
            <Text style={styles.headCell}>Category</Text>
            <Text style={styles.headCell}>Amount</Text>
            <Text style={styles.headCell}>Status</Text>
          </View>
          {activities.length ? activities.map((activity) => (
            <View style={styles.row} key={text(activity.id)}>
              <Text style={styles.cell}>{dateLabel(activity.transaction_date)}</Text>
              <Text style={styles.cell}>{activityLabel(activity)}</Text>
              <Text style={styles.cell}>{text(activity.category)}</Text>
              <Text style={styles.cell}>{amount(activity.amount)}</Text>
              <Text style={styles.cell}>{text(activity.status)}</Text>
            </View>
          )) : <Text style={styles.small}>No Finance activity has been posted for this project.</Text>}
        </View>
      </Page>
    </Document>
  );
}
