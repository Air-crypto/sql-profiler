import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the SQL optimization lab", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Loopbase — SQL Optimization Lab<\/title>/i);
  assert.match(html, /Find the expensive part\./);
  assert.match(html, /Retail/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("ships a generalized workload optimizer and removes starter preview code", async () => {
  const [page, lab, optimizer, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lab.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/generalized-optimizer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Join overlap/);
  assert.match(page, /Modeled runs \/ week/);
  assert.match(page, /Cluster simulation/);
  assert.match(page, /MULTI-NODE SCALING LAB/);
  assert.match(page, /Compute nodes \/ VMs/);
  assert.match(page, /simulateCompute/);
  assert.match(page, /deriveJoinHotspots/);
  assert.match(optimizer, /parseQueryModel/);
  assert.match(optimizer, /recordWorkload/);
  assert.match(optimizer, /parallelGroup/);
  assert.match(optimizer, /DEFAULT_COMPUTE_CONFIG/);
  assert.match(optimizer, /spillMs/);
  assert.match(optimizer, /CREATE MATERIALIZED VIEW/);
  assert.doesNotMatch(optimizer, /EXAMPLES\.find|normalized\(example\.sql\)/);
  assert.doesNotMatch(lab, /order_customer_facts|JOIN_HOTSPOTS/);
  assert.match(layout, /Loopbase — SQL Optimization Lab/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
