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
  parallelGroup?: number;
  workers?: number;
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
  ];
}

export const LAB_TABLES = buildTables();

type AlaTable = { data: DataRow[] };
type LabDatabase = {
  tables: Record<string, AlaTable>;
  exec<T>(sql: string): T;
};

let database: LabDatabase | null = null;
const runtimeTables = new Map<string, LabTable>();

const sqlTypes: Record<TableColumn["type"], string> = {
  integer: "INT",
  decimal: "DECIMAL",
  text: "STRING",
  date: "DATE",
  boolean: "BOOLEAN",
};

function getDatabase(): LabDatabase {
  if (database) return database;
  const db = new alasql.Database() as unknown as LabDatabase;

  for (const table of LAB_TABLES) {
    const definition = table.columns.map((column) => `${column.name} ${sqlTypes[column.type]}`).join(", ");
    db.exec(`CREATE TABLE ${table.name} (${definition})`);
    db.tables[table.name].data = table.data;
  }
  database = db;
  return db;
}

export function getLabTable(name: string): LabTable | undefined {
  return LAB_TABLES.find((table) => table.name === name) ?? runtimeTables.get(name);
}

export function registerRuntimeTable(table: LabTable): void {
  const db = getDatabase();
  runtimeTables.set(table.name, table);
  if (db.tables[table.name]) {
    db.tables[table.name].data = table.data;
    return;
  }
  const definition = table.columns.map((column) => `${column.name} ${sqlTypes[column.type]}`).join(", ");
  db.exec(`CREATE TABLE ${table.name} (${definition})`);
  db.tables[table.name].data = table.data;
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

function execute(sql: string): { rows: DataRow[]; elapsedMs: number } {
  validateReadOnly(sql);
  const db = getDatabase();
  const started = performance.now();
  const result = db.exec<unknown>(sql.replace(/;\s*$/, ""));
  const elapsedMs = performance.now() - started;
  if (!Array.isArray(result)) throw new Error("The query did not return a result set.");
  return { rows: result as DataRow[], elapsedMs };
}

export function executeLabSQL(sql: string): { rows: DataRow[]; elapsedMs: number } {
  return execute(sql);
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
