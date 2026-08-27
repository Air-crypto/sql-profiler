import alasql from "alasql";

export type DataRow = Record<string, string | number | boolean | null>;

export type TableColumn = {
  name: string;
  type: "integer" | "decimal" | "text" | "date" | "boolean";
  key?: "PK" | "FK";
};

export type LabTable = {
  name: string;
  label: string;
  tone: "blue" | "lime" | "coral" | "violet";
  columns: TableColumn[];
  data: DataRow[];
};

export type Finding = {
  id: string;
  title: string;
  detail: string;
  fix: string;
  impact: "high" | "medium" | "low";
  estimatedGain: string;
};

export type PlanStep = {
  operation: string;
  detail: string;
  rows: number;
  cost: number;
  tone: "scan" | "filter" | "join" | "compute";
};

export type QueryAnalysis = {
  health: number;
  findings: Finding[];
  touchedRows: number;
  estimatedCost: number;
  referencedTables: string[];
  plan: PlanStep[];
  rewriteSQL: string | null;
  rewriteLabel: string | null;
};

export type QueryRun = {
  rows: DataRow[];
  elapsedMs: number;
  analysis: QueryAnalysis;
  rewritten: null | {
    sql: string;
    rows: DataRow[];
    elapsedMs: number;
    analysis: QueryAnalysis;
    sameResult: boolean;
  };
};

function seededRandom(seed = 1919) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const random = seededRandom();
const firstNames = ["Maya", "Theo", "Lina", "Jonah", "Avery", "Nora", "Eli", "Zara", "Milo", "Iris", "Noah", "Cleo"];
const lastNames = ["Chen", "Patel", "Garcia", "Kim", "Okafor", "Nguyen", "Smith", "Brown", "Wilson", "Singh", "Davis", "Martin"];
const regions = ["West", "Northeast", "South", "Midwest"];
const segments = ["Consumer", "Small Business", "Enterprise"];
const categories = ["Audio", "Office", "Kitchen", "Outdoor", "Wellness", "Lighting"];
const adjectives = ["Orbit", "Field", "Studio", "Daily", "Core", "Signal", "North", "Arc"];
const nouns = ["Lamp", "Speaker", "Bottle", "Stand", "Pack", "Tray", "Chair", "Headphones"];
const channels = ["web", "mobile", "store"];
const statuses = ["paid", "paid", "paid", "shipped", "shipped", "refunded"];

function pick<T>(values: T[]): T {
  return values[Math.floor(random() * values.length)];
}

function isoDate(startYear: number, spanDays: number): string {
  const base = Date.UTC(startYear, 0, 1);
  const sampled = new Date(base + Math.floor(random() * spanDays) * 86400000);
  // AlaSQL's YEAR() follows the browser timezone for midnight date strings.
  // Avoid the Jan 1 boundary so the teaching example is stable in every zone.
  if (sampled.getUTCMonth() === 0 && sampled.getUTCDate() === 1) sampled.setUTCDate(2);
  return sampled.toISOString().slice(0, 10);
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildTables(): LabTable[] {
  const customers: DataRow[] = Array.from({ length: 1200 }, (_, index) => ({
    id: index + 1,
    name: `${pick(firstNames)} ${pick(lastNames)}`,
    region: pick(regions),
    segment: pick(segments),
    joined_at: isoDate(2021, 1460),
  }));

  const customerProfiles: DataRow[] = customers.map((customer, index) => ({
    customer_id: customer.id,
    email: `customer${index + 1}@example.test`,
    country: pick(["US", "US", "US", "CA", "GB", "DE"]),
    loyalty_tier: pick(["standard", "standard", "silver", "gold"]),
    risk_score: Math.floor(random() * 100),
    marketing_opt_in: random() > 0.32,
  }));

  const productCategories: DataRow[] = categories.map((name, index) => ({
    id: index + 1,
    name,
    department: index < 2 ? "Work" : index < 4 ? "Home" : "Lifestyle",
    margin_target: money(0.24 + random() * 0.28),
  }));

  const suppliers: DataRow[] = Array.from({ length: 120 }, (_, index) => ({
    id: index + 1,
    name: `${pick(adjectives)} Supply ${String(index + 1).padStart(3, "0")}`,
    country: pick(["US", "MX", "CN", "VN", "DE", "CA"]),
    lead_time_days: 3 + Math.floor(random() * 42),
    quality_score: money(70 + random() * 30),
  }));

  const products: DataRow[] = Array.from({ length: 800 }, (_, index) => {
    const category = productCategories[Math.floor(random() * productCategories.length)];
    return {
    id: index + 1,
    sku: `SKU-${String(index + 1).padStart(4, "0")}`,
    name: `${pick(adjectives)} ${pick(nouns)}`,
    category_id: category.id,
    category: category.name,
    supplier_id: 1 + Math.floor(random() * suppliers.length),
    unit_price: money(12 + random() * 268),
    active: random() > 0.08,
    };
  });

  const warehouses: DataRow[] = ["Oakland", "Reno", "Austin", "Chicago", "Atlanta", "Newark", "Toronto", "Phoenix"].map((name, index) => ({
    id: index + 1,
    name,
    region: index < 2 || index === 7 ? "West" : index < 5 ? "Central" : "East",
    capacity: 18000 + Math.floor(random() * 32000),
  }));

  const orders: DataRow[] = Array.from({ length: 15000 }, (_, index) => ({
    id: index + 1,
    customer_id: 1 + Math.floor(random() * customers.length),
    created_at: isoDate(2023, 1095),
    status: pick(statuses),
    total_amount: 0,
    channel: pick(channels),
  }));

  const orderItems: DataRow[] = [];
  for (let index = 0; index < 42000; index += 1) {
    const orderId = 1 + Math.floor(random() * orders.length);
    const product = products[Math.floor(random() * products.length)];
    const quantity = 1 + Math.floor(random() * 4);
    const unitPrice = Number(product.unit_price);
    orderItems.push({
      id: index + 1,
      order_id: orderId,
      product_id: product.id,
      quantity,
      unit_price: unitPrice,
    });
    orders[orderId - 1].total_amount = money(Number(orders[orderId - 1].total_amount) + quantity * unitPrice);
  }

  const payments: DataRow[] = Array.from({ length: 17500 }, (_, index) => {
    const order = orders[Math.floor(random() * orders.length)];
    const state = pick(["captured", "captured", "captured", "failed", "refunded"]);
    return {
      id: index + 1,
      order_id: order.id,
      paid_at: isoDate(2023, 1095),
      amount: state === "captured" ? order.total_amount : money(Number(order.total_amount) * random()),
      method: pick(["card", "card", "wallet", "bank"]),
      state,
    };
  });

  const shipments: DataRow[] = Array.from({ length: 13000 }, (_, index) => {
    const shippedAt = isoDate(2023, 1095);
    return {
      id: index + 1,
      order_id: index + 1,
      warehouse_id: 1 + Math.floor(random() * warehouses.length),
      shipped_at: shippedAt,
      delivered_at: random() > 0.12 ? shippedAt : null,
      carrier: pick(["ParcelOne", "Northstar", "SwiftShip"]),
      shipping_cost: money(4 + random() * 28),
    };
  });

  const inventory: DataRow[] = Array.from({ length: 2400 }, (_, index) => ({
    id: index + 1,
    product_id: 1 + Math.floor(random() * products.length),
    warehouse_id: 1 + Math.floor(random() * warehouses.length),
    on_hand: Math.floor(random() * 420),
    reorder_point: 20 + Math.floor(random() * 90),
    updated_at: isoDate(2025, 365),
  }));

  const supportTickets: DataRow[] = Array.from({ length: 3500 }, (_, index) => {
    const order = orders[Math.floor(random() * orders.length)];
    return {
      id: index + 1,
      customer_id: order.customer_id,
      order_id: order.id,
      opened_at: isoDate(2024, 730),
      issue_type: pick(["delivery", "refund", "product", "billing"]),
      priority: pick(["low", "normal", "normal", "high"]),
      resolved: random() > 0.19,
    };
  });

  const customerById = new Map(customers.map((customer) => [Number(customer.id), customer]));
  const orderCustomerFacts: DataRow[] = orders.map((order) => {
    const customer = customerById.get(Number(order.customer_id))!;
    return {
      order_id: order.id,
      customer_id: order.customer_id,
      customer_name: customer.name,
      region: customer.region,
      segment: customer.segment,
      created_at: order.created_at,
      status: order.status,
      total_amount: order.total_amount,
      channel: order.channel,
    };
  });

  return [
    {
      name: "customers",
      label: "Customer accounts",
      tone: "blue",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "name", type: "text" },
        { name: "region", type: "text" },
        { name: "segment", type: "text" },
        { name: "joined_at", type: "date" },
      ],
      data: customers,
    },
    {
      name: "customer_profiles",
      label: "Customer profile extension",
      tone: "violet",
      columns: [
        { name: "customer_id", type: "integer", key: "FK" },
        { name: "email", type: "text" },
        { name: "country", type: "text" },
        { name: "loyalty_tier", type: "text" },
        { name: "risk_score", type: "integer" },
        { name: "marketing_opt_in", type: "boolean" },
      ],
      data: customerProfiles,
    },
    {
      name: "orders",
      label: "Commerce orders",
      tone: "lime",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "customer_id", type: "integer", key: "FK" },
        { name: "created_at", type: "date" },
        { name: "status", type: "text" },
        { name: "total_amount", type: "decimal" },
        { name: "channel", type: "text" },
      ],
      data: orders,
    },
    {
      name: "order_items",
      label: "Order line items",
      tone: "coral",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "order_id", type: "integer", key: "FK" },
        { name: "product_id", type: "integer", key: "FK" },
        { name: "quantity", type: "integer" },
        { name: "unit_price", type: "decimal" },
      ],
      data: orderItems,
    },
    {
      name: "payments",
      label: "Payment attempts",
      tone: "blue",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "order_id", type: "integer", key: "FK" },
        { name: "paid_at", type: "date" },
        { name: "amount", type: "decimal" },
        { name: "method", type: "text" },
        { name: "state", type: "text" },
      ],
      data: payments,
    },
    {
      name: "shipments",
      label: "Fulfillment shipments",
      tone: "lime",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "order_id", type: "integer", key: "FK" },
        { name: "warehouse_id", type: "integer", key: "FK" },
        { name: "shipped_at", type: "date" },
        { name: "delivered_at", type: "date" },
        { name: "carrier", type: "text" },
        { name: "shipping_cost", type: "decimal" },
      ],
      data: shipments,
    },
    {
      name: "products",
      label: "Product catalog",
      tone: "violet",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "sku", type: "text" },
        { name: "name", type: "text" },
        { name: "category_id", type: "integer", key: "FK" },
        { name: "category", type: "text" },
        { name: "supplier_id", type: "integer", key: "FK" },
        { name: "unit_price", type: "decimal" },
        { name: "active", type: "boolean" },
      ],
      data: products,
    },
    {
      name: "product_categories",
      label: "Product category dimension",
      tone: "coral",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "name", type: "text" },
        { name: "department", type: "text" },
        { name: "margin_target", type: "decimal" },
      ],
      data: productCategories,
    },
    {
      name: "suppliers",
      label: "Supplier directory",
      tone: "blue",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "name", type: "text" },
        { name: "country", type: "text" },
        { name: "lead_time_days", type: "integer" },
        { name: "quality_score", type: "decimal" },
      ],
      data: suppliers,
    },
    {
      name: "warehouses",
      label: "Warehouse network",
      tone: "violet",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "name", type: "text" },
        { name: "region", type: "text" },
        { name: "capacity", type: "integer" },
      ],
      data: warehouses,
    },
    {
      name: "inventory",
      label: "Warehouse product stock",
      tone: "lime",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "product_id", type: "integer", key: "FK" },
        { name: "warehouse_id", type: "integer", key: "FK" },
        { name: "on_hand", type: "integer" },
        { name: "reorder_point", type: "integer" },
        { name: "updated_at", type: "date" },
      ],
      data: inventory,
    },
    {
      name: "support_tickets",
      label: "Customer support cases",
      tone: "coral",
      columns: [
        { name: "id", type: "integer", key: "PK" },
        { name: "customer_id", type: "integer", key: "FK" },
        { name: "order_id", type: "integer", key: "FK" },
        { name: "opened_at", type: "date" },
        { name: "issue_type", type: "text" },
        { name: "priority", type: "text" },
        { name: "resolved", type: "boolean" },
      ],
      data: supportTickets,
    },
    {
      name: "order_customer_facts",
      label: "Materialized order + customer join",
      tone: "coral",
      columns: [
        { name: "order_id", type: "integer", key: "PK" },
        { name: "customer_id", type: "integer", key: "FK" },
        { name: "customer_name", type: "text" },
        { name: "region", type: "text" },
        { name: "segment", type: "text" },
        { name: "created_at", type: "date" },
        { name: "status", type: "text" },
        { name: "total_amount", type: "decimal" },
        { name: "channel", type: "text" },
      ],
      data: orderCustomerFacts,
    },
  ];
}

export const LAB_TABLES = buildTables();

export const EXAMPLES = [
  {
    id: "materialized-customer-orders",
    label: "Hot join → materialized fact",
    sql: `SELECT c.region,
       c.segment,
       COUNT(*) AS order_count,
       SUM(o.total_amount) AS revenue,
       AVG(o.total_amount) AS avg_order_value
FROM customers c
JOIN orders o ON c.id = o.customer_id
WHERE o.created_at >= '2025-01-01'
  AND o.created_at < '2026-01-01'
  AND o.status IN ('paid', 'shipped')
GROUP BY c.region, c.segment
ORDER BY revenue DESC;`,
    rewrite: `SELECT region,
       segment,
       COUNT(*) AS order_count,
       SUM(total_amount) AS revenue,
       AVG(total_amount) AS avg_order_value
FROM order_customer_facts
WHERE created_at >= '2025-01-01'
  AND created_at < '2026-01-01'
  AND status IN ('paid', 'shipped')
GROUP BY region, segment
ORDER BY revenue DESC;`,
    rewriteLabel: "Reuse the materialized order + customer fact",
  },
  {
    id: "supply-chain-revenue",
    label: "8-table supply-chain revenue",
    sql: `SELECT c.region AS customer_region,
       pc.department,
       s.name AS supplier,
       w.name AS warehouse,
       COUNT(*) AS joined_rows,
       SUM(oi.quantity * oi.unit_price) AS gross_revenue,
       SUM(sh.shipping_cost) AS shipping_cost
FROM customers c
JOIN orders o ON c.id = o.customer_id
JOIN order_items oi ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
JOIN product_categories pc ON pc.id = p.category_id
JOIN suppliers s ON s.id = p.supplier_id
JOIN shipments sh ON sh.order_id = o.id
JOIN warehouses w ON w.id = sh.warehouse_id
WHERE o.created_at >= '2025-01-01'
  AND o.status IN ('paid', 'shipped')
GROUP BY c.region, pc.department, s.name, w.name
ORDER BY gross_revenue DESC;`,
    rewrite: null,
    rewriteLabel: null,
  },
  {
    id: "customer-360-fanout",
    label: "Customer 360 join fan-out",
    sql: `SELECT c.id,
       c.name,
       cp.loyalty_tier,
       COUNT(*) AS joined_rows,
       SUM(o.total_amount) AS order_value,
       SUM(pay.amount) AS captured_value
FROM customers c
JOIN customer_profiles cp ON cp.customer_id = c.id
JOIN orders o ON o.customer_id = c.id
JOIN payments pay ON pay.order_id = o.id
JOIN support_tickets st ON st.customer_id = c.id
WHERE pay.state = 'captured'
  AND st.resolved = false
GROUP BY c.id, c.name, cp.loyalty_tier
ORDER BY captured_value DESC;`,
    rewrite: null,
    rewriteLabel: null,
  },
  {
    id: "inventory-network",
    label: "5-table inventory risk",
    sql: `SELECT w.region AS warehouse_region,
       pc.department,
       s.name AS supplier,
       COUNT(*) AS inventory_rows,
       SUM(i.on_hand) AS units,
       SUM(i.on_hand * p.unit_price) AS inventory_value
FROM inventory i
JOIN warehouses w ON w.id = i.warehouse_id
JOIN products p ON p.id = i.product_id
JOIN product_categories pc ON pc.id = p.category_id
JOIN suppliers s ON s.id = p.supplier_id
WHERE i.on_hand < i.reorder_point
GROUP BY w.region, pc.department, s.name
ORDER BY inventory_value DESC;`,
    rewrite: null,
    rewriteLabel: null,
  },
  {
    id: "date-report",
    label: "Non-sargable date report",
    sql: `SELECT *
FROM customers c
JOIN orders o ON c.id = o.customer_id
WHERE YEAR(o.created_at) = 2025
ORDER BY o.total_amount DESC;`,
    rewrite: `SELECT *
FROM customers c
JOIN orders o ON c.id = o.customer_id
WHERE o.created_at >= '2025-01-01'
  AND o.created_at < '2026-01-01'
ORDER BY o.total_amount DESC;`,
    rewriteLabel: "Use a bounded date range",
  },
  {
    id: "subquery-region",
    label: "Repeated membership subquery",
    sql: `SELECT o.customer_id,
       COUNT(*) AS order_count,
       SUM(o.total_amount) AS revenue
FROM orders o
WHERE o.customer_id IN (
  SELECT c.id FROM customers c WHERE c.region = 'West'
)
GROUP BY o.customer_id
ORDER BY revenue DESC;`,
    rewrite: `SELECT o.customer_id,
       COUNT(*) AS order_count,
       SUM(o.total_amount) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.region = 'West'
GROUP BY o.customer_id
ORDER BY revenue DESC;`,
    rewriteLabel: "Turn membership into an explicit join",
  },
] as const;

export const JOIN_HOTSPOTS = [
  { pair: "customers ↔ orders", runs: 1240, rowWork: "18.6M", recommendation: "order_customer_facts", action: "Materialize", gain: "31–48%" },
  { pair: "orders ↔ order_items", runs: 920, rowWork: "38.6M", recommendation: "order_line_rollup", action: "Pre-aggregate", gain: "35–60%" },
  { pair: "products ↔ product_categories", runs: 760, rowWork: "608k", recommendation: "product_dimension", action: "Denormalize", gain: "12–24%" },
  { pair: "orders ↔ payments", runs: 540, rowWork: "9.5M", recommendation: "payment_totals", action: "Aggregate", gain: "28–44%" },
  { pair: "orders ↔ shipments", runs: 410, rowWork: "5.3M", recommendation: "fulfillment_facts", action: "Materialize", gain: "22–37%" },
] as const;

type AlaTable = { data: DataRow[] };
type LabDatabase = {
  tables: Record<string, AlaTable>;
  exec<T>(sql: string): T;
};

let database: LabDatabase | null = null;

function getDatabase(): LabDatabase {
  if (database) return database;
  const db = new alasql.Database() as unknown as LabDatabase;
  const sqlTypes: Record<TableColumn["type"], string> = {
    integer: "INT",
    decimal: "DECIMAL",
    text: "STRING",
    date: "DATE",
    boolean: "BOOLEAN",
  };

  for (const table of LAB_TABLES) {
    const definition = table.columns.map((column) => `${column.name} ${sqlTypes[column.type]}`).join(", ");
    db.exec(`CREATE TABLE ${table.name} (${definition})`);
    db.tables[table.name].data = table.data;
  }
  database = db;
  return db;
}

function normalized(sql: string): string {
  return sql.replace(/--.*$/gm, " ").replace(/\s+/g, " ").replace(/;$/, "").trim().toLowerCase();
}

function validateReadOnly(sql: string): void {
  const clean = sql.trim();
  if (!/^(select|with)\b/i.test(clean)) {
    throw new Error("This lab is read-only. Start the query with SELECT or WITH.");
  }
  const withoutTrailing = clean.replace(/;\s*$/, "");
  if (withoutTrailing.includes(";")) {
    throw new Error("Run one statement at a time so the comparison stays auditable.");
  }
  if (/\b(insert|update|delete|drop|alter|create|truncate|merge|call|execute)\b/i.test(withoutTrailing)) {
    throw new Error("Mutation statements are disabled in the sample workspace.");
  }
  if (/\bcross\s+join\b/i.test(withoutTrailing)) {
    throw new Error("CROSS JOIN is disabled because it can freeze an in-browser sandbox.");
  }
}

function referencedTables(sql: string): string[] {
  const found = new Set<string>();
  const tableNames = LAB_TABLES.map((table) => table.name);
  const sourceRegex = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = sourceRegex.exec(sql)) !== null) {
    if (tableNames.includes(match[1].toLowerCase())) found.add(match[1].toLowerCase());
  }
  return [...found];
}

function exampleRewrite(sql: string): { sql: string; label: string } | null {
  const match = EXAMPLES.find((example) => normalized(example.sql) === normalized(sql));
  if (match?.rewrite && match.rewriteLabel) return { sql: match.rewrite, label: match.rewriteLabel };

  let rewritten = sql;
  let changed = false;
  rewritten = rewritten.replace(
    /YEAR\s*\(\s*([a-z_][\w.]*?)\s*\)\s*=\s*(20\d{2})/gi,
    (_full, column: string, yearText: string) => {
      changed = true;
      const year = Number(yearText);
      return `${column} >= '${year}-01-01' AND ${column} < '${year + 1}-01-01'`;
    },
  );
  return changed ? { sql: rewritten, label: "Use a bounded date range" } : null;
}

function findingList(sql: string, tables: string[]): Finding[] {
  const findings: Finding[] = [];
  const compact = normalized(sql);
  const add = (finding: Finding) => findings.push(finding);

  if (tables.includes("customers") && tables.includes("orders") && !tables.includes("order_customer_facts")) {
    add({
      id: "hot-customer-order-join",
      title: "This join repeats 1,240 times per week",
      detail: "The workload profile repeatedly reconstructs customer region and segment on top of each order.",
      fix: "Serve this pattern from order_customer_facts and refresh it incrementally when orders change.",
      impact: "high",
      estimatedGain: "31–48% less repeated join work",
    });
  }
  if ((tables.includes("payments") && tables.includes("support_tickets")) || (tables.includes("order_items") && tables.includes("shipments"))) {
    add({
      id: "independent-fanout",
      title: "Independent one-to-many joins multiply rows",
      detail: "Joining two many-sided relations at once creates combinations before the final aggregation and can inflate sums.",
      fix: "Aggregate each many-side to its parent key first, then join the compact results.",
      impact: "high",
      estimatedGain: "fixes totals + shrinks intermediate rows",
    });
  }
  if (tables.length >= 6) {
    add({
      id: "deep-join-graph",
      title: `${tables.length} source tables make this plan brittle`,
      detail: "Cardinality errors compound as the optimizer chooses an order across a deep join graph.",
      fix: "Split stable dimensions from high-grain facts and reuse a tested intermediate model.",
      impact: "medium",
      estimatedGain: "fewer plan permutations and spills",
    });
  }

  if (/select\s+(?:[a-z_]\w*\.)?\*/i.test(sql)) {
    add({
      id: "projection",
      title: "Project only the columns you use",
      detail: "SELECT * moves every field through the join and makes the result contract fragile.",
      fix: "Replace * with the exact customer and order fields required by the consumer.",
      impact: "high",
      estimatedGain: "20–45% less data moved",
    });
  }
  if (/\byear\s*\(/i.test(sql)) {
    add({
      id: "sargable-date",
      title: "Make the date predicate searchable",
      detail: "YEAR(created_at) must be evaluated row by row before the engine can filter.",
      fix: "Use created_at >= 'YYYY-01-01' and created_at < 'YYYY+1-01-01'.",
      impact: "high",
      estimatedGain: "up to 66% fewer rows scanned",
    });
  }
  if (/\b(lower|upper|cast|substring)\s*\([^)]*\)\s*(=|like|>|<)/i.test(sql)) {
    add({
      id: "wrapped-filter",
      title: "Avoid functions on filtered columns",
      detail: "Transforming a column inside the predicate prevents a direct lookup on its stored value.",
      fix: "Normalize at write time or add a dedicated normalized/search column and index it.",
      impact: "medium",
      estimatedGain: "table scan → targeted lookup",
    });
  }
  if (/like\s+'%/i.test(sql)) {
    add({
      id: "leading-wildcard",
      title: "A leading wildcard forces a scan",
      detail: "LIKE '%term%' cannot seek from the beginning of a conventional index.",
      fix: "Use a search index, token table, or a prefix query if the product behavior allows it.",
      impact: "high",
      estimatedGain: "O(n) scan → indexed search",
    });
  }
  if (/\bin\s*\(\s*select\b/i.test(sql)) {
    add({
      id: "membership-subquery",
      title: "Express membership as a join",
      detail: "The nested membership set hides the relationship and can be rebuilt repeatedly.",
      fix: "Join the filtered customer set once on customer_id.",
      impact: "medium",
      estimatedGain: "one reusable join pass",
    });
  }
  if (/\bdistinct\b/i.test(sql) && /\bjoin\b/i.test(sql)) {
    add({
      id: "distinct-after-join",
      title: "Do not use DISTINCT to repair join fan-out",
      detail: "Deduplicating after a wide join sorts or hashes a larger intermediate result.",
      fix: "Fix the join cardinality or use EXISTS when only membership matters.",
      impact: "medium",
      estimatedGain: "smaller intermediate result",
    });
  }
  if (/\border\s+by\b/i.test(sql) && !/\blimit\s+\d+/i.test(sql) && !/\bgroup\s+by\b/i.test(sql)) {
    add({
      id: "unbounded-sort",
      title: "The final sort is unbounded",
      detail: "Every qualifying row must be retained and sorted before the client sees the first row.",
      fix: "Add a LIMIT for interactive exploration, or paginate with a stable sort key.",
      impact: "medium",
      estimatedGain: "lower memory pressure",
    });
  }
  if (tables.length >= 3 && /\bgroup\s+by\b/i.test(sql)) {
    add({
      id: "preaggregate",
      title: "Aggregate before the widest join",
      detail: "Line items are joined at full grain before being reduced into the final dimensions.",
      fix: "Pre-aggregate order_items by order_id and product_id, then join the smaller relation.",
      impact: "high",
      estimatedGain: "35–60% smaller join input",
    });
  }
  if (!/\bwhere\b/i.test(compact) && tables.some((name) => name === "orders" || name === "order_items")) {
    add({
      id: "unfiltered-scan",
      title: "Large fact tables are unfiltered",
      detail: "The query reads the full fact-table history on every execution.",
      fix: "Push a date, status, or partition predicate as close to the source as possible.",
      impact: "high",
      estimatedGain: "depends on retained history",
    });
  }
  return findings.slice(0, 5);
}

export function analyzeQuery(sql: string): QueryAnalysis {
  const tables = referencedTables(sql);
  const findings = findingList(sql, tables);
  const plan: PlanStep[] = [];
  let touchedRows = 0;
  const plainDateRange = /created_at\s*>=\s*'20\d{2}-01-01'/i.test(sql);
  const hasWhere = /\bwhere\b/i.test(sql);

  tables.forEach((name) => {
    const table = LAB_TABLES.find((candidate) => candidate.name === name)!;
    let scanned = table.data.length;
    let detail = `Sequential scan of ${name}`;
    if ((name === "orders" || name === "order_customer_facts") && plainDateRange) {
      scanned = Math.round(scanned * 0.34);
      detail = name === "order_customer_facts" ? "Range scan of materialized order + customer rows" : "Range scan on orders.created_at";
    } else if (hasWhere && name !== "order_items" && !/\b(year|lower|upper)\s*\(/i.test(sql)) {
      scanned = Math.max(1, Math.round(scanned * 0.55));
      detail = `Filtered scan of ${name}`;
    }
    touchedRows += scanned;
    const scanCost = name === "order_customer_facts" ? Math.round(scanned * 0.78) : scanned;
    plan.push({ operation: "SCAN", detail, rows: scanned, cost: scanCost, tone: "scan" });
  });

  let streamRows = Math.max(1, Math.max(...(plan.length ? plan.map((step) => step.rows) : [1])));
  if (hasWhere) {
    const filterRows = Math.max(1, Math.round(streamRows * (/like\s+'%/i.test(sql) ? 0.18 : 0.42)));
    plan.push({
      operation: "FILTER",
      detail: /\b(year|lower|upper)\s*\(/i.test(sql) ? "Evaluate expression for each candidate row" : "Apply pushed predicates",
      rows: filterRows,
      cost: Math.round(streamRows * 0.28),
      tone: "filter",
    });
    streamRows = filterRows;
  }

  if (/\bin\s*\(\s*select\b/i.test(sql)) {
    plan.push({
      operation: "SUBQUERY",
      detail: "Build and probe the nested membership set",
      rows: streamRows,
      cost: Math.round(streamRows * 1.6),
      tone: "compute",
    });
  }

  const joinCount = (sql.match(/\bjoin\b/gi) || []).length;
  for (let index = 0; index < joinCount; index += 1) {
    streamRows = Math.max(1, Math.round(streamRows * 1.35));
    plan.push({
      operation: "HASH JOIN",
      detail: `Resolve relationship ${index + 1} of ${joinCount}`,
      rows: streamRows,
      cost: Math.round(streamRows * 0.9),
      tone: "join",
    });
  }
  if (/\bgroup\s+by\b/i.test(sql)) {
    streamRows = Math.max(1, Math.round(Math.sqrt(streamRows) * 3));
    plan.push({ operation: "AGGREGATE", detail: "Hash rows into requested groups", rows: streamRows, cost: streamRows * 4, tone: "compute" });
  }
  if (/\border\s+by\b/i.test(sql)) {
    plan.push({ operation: "SORT", detail: /\blimit\b/i.test(sql) ? "Top-N ordered result" : "Order complete result set", rows: streamRows, cost: Math.round(streamRows * Math.log2(streamRows + 1)), tone: "compute" });
  }

  const penalty = findings.reduce((score, finding) => score + ({ high: 17, medium: 10, low: 5 }[finding.impact]), 0);
  const rewrite = exampleRewrite(sql);
  return {
    health: Math.max(28, 100 - penalty),
    findings,
    touchedRows,
    estimatedCost: plan.reduce((total, step) => total + step.cost, 0),
    referencedTables: tables,
    plan,
    rewriteSQL: rewrite?.sql ?? null,
    rewriteLabel: rewrite?.label ?? null,
  };
}

function stableRows(rows: DataRow[]): string {
  const canonical = rows.map((row) => JSON.stringify(Object.fromEntries(
    Object.entries(row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, typeof value === "number" ? Math.round(value * 1_000_000) / 1_000_000 : value]),
  )));
  return JSON.stringify(canonical.sort());
}

function execute(sql: string): { rows: DataRow[]; elapsedMs: number } {
  validateReadOnly(sql);
  const db = getDatabase();
  const started = performance.now();
  const result = db.exec<unknown>(sql.replace(/;\s*$/, ""));
  const elapsedMs = performance.now() - started;
  if (!Array.isArray(result)) throw new Error("The query did not return a result set.");
  return { rows: result as DataRow[], elapsedMs };
}

export function runLabQuery(sql: string): QueryRun {
  const analysis = analyzeQuery(sql);
  const baseline = execute(sql);
  let rewritten: QueryRun["rewritten"] = null;
  if (analysis.rewriteSQL) {
    try {
      const candidate = execute(analysis.rewriteSQL);
      rewritten = {
        sql: analysis.rewriteSQL,
        rows: candidate.rows,
        elapsedMs: candidate.elapsedMs,
        analysis: analyzeQuery(analysis.rewriteSQL),
        sameResult: stableRows(baseline.rows) === stableRows(candidate.rows),
      };
    } catch {
      rewritten = null;
    }
  }
  return { ...baseline, analysis, rewritten };
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function formatCell(value: DataRow[string]): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && !Number.isInteger(value)) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(value);
}
