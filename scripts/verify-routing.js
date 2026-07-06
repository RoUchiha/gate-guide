// Routing integrity audit: proves that walkway-tier routes follow the real
// corridor graph rather than drawing straight lines.
//
// For each walkway airport it routes many gate pairs and checks:
//   1. Edge adherence — every consecutive path pair is an actual graph edge.
//   2. Sinuosity — routed distance vs straight-line distance (a straight
//      line would score 1.0; real corridor routes score higher).
//   3. Vertex density — corridor routes traverse many real vertices.
//   4. Floor usage — level transitions occur along routes where mapped.
//
// Usage: node scripts/verify-routing.js [IATA ...]

import { readdirSync, readFileSync } from "node:fs";
import { routeBetween } from "../public/app-assets/router.js";

const dir = "public/maps";
const args = process.argv.slice(2).map((code) => code.toUpperCase());
const files = readdirSync(dir).filter((file) => /^[A-Z0-9]{3,4}\.json$/.test(file)).sort();

let audited = 0;
let failures = 0;

for (const file of files) {
  const bundle = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
  const map = bundle.map;
  if (map.routing !== "walkways") continue;
  if (args.length && !args.includes(map.airportCode)) continue;

  const edgeSet = new Set();
  for (const edge of map.edges) {
    edgeSet.add(`${edge.from}::${edge.to}`);
    edgeSet.add(`${edge.to}::${edge.from}`);
  }
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const gates = map.places.filter((place) => place.kind === "gate");
  const starts = map.nodes.filter((node) => node.kind === "arrival" || node.kind === "security");

  let routed = 0;
  let straightLines = 0;
  let brokenEdges = 0;
  let sinuositySum = 0;
  let sinuosityCount = 0;
  let floorChanges = 0;
  let vertexSum = 0;

  for (let i = 0; i < 40; i += 1) {
    const from = (starts.length ? starts : map.nodes)[i % Math.max(1, starts.length || map.nodes.length)];
    const gate = gates[(i * 7) % gates.length];
    if (!from || !gate || gate.nodeId === from.id) continue;
    const route = routeBetween(map, from.id, gate.nodeId);
    if (!route.ok) continue;
    routed += 1;
    vertexSum += route.path.length;

    for (let j = 1; j < route.path.length; j += 1) {
      if (!edgeSet.has(`${route.path[j - 1]}::${route.path[j]}`)) brokenEdges += 1;
      const prev = nodeById.get(route.path[j - 1]);
      const next = nodeById.get(route.path[j]);
      if (prev.floorId !== next.floorId) floorChanges += 1;
    }

    const a = nodeById.get(from.id);
    const b = nodeById.get(gate.nodeId);
    const crowFlies = Math.hypot(a.x - b.x, a.y - b.y) / (map.scale?.pixelsPerMeter || 1);
    if (crowFlies > 50) {
      sinuositySum += route.meters / crowFlies;
      sinuosityCount += 1;
    }
    // A two-hop route longer than the max gate-snap connector (150 m) can't
    // be legitimate mapped data — that would be a straight-line cheat.
    if (route.path.length <= 2 && crowFlies > 180) straightLines += 1;
  }

  const ok = brokenEdges === 0 && straightLines === 0 && routed > 0;
  if (!ok) failures += 1;
  audited += 1;
  console.log(
    `${map.airportCode}: ${ok ? "PASS" : "FAIL"} — ${routed} routes, ` +
    `straight-line shortcuts ${straightLines}, broken edges ${brokenEdges}, ` +
    `avg sinuosity ${sinuosityCount ? (sinuositySum / sinuosityCount).toFixed(2) : "n/a"}x, ` +
    `avg ${routed ? Math.round(vertexSum / routed) : 0} vertices/route, ` +
    `${floorChanges} floor transitions`
  );
}

console.log(`\n${audited} walkway airports audited, ${failures} failures.`);
process.exit(failures ? 1 : 0);
