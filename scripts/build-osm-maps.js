// Builds production airport map bundles from real OpenStreetMap indoor data.
//
// For each candidate airport this script pulls gates, walkways, security
// checkpoints, entrances, and amenities from the Overpass API, assembles a
// routable graph with haversine edge lengths, and keeps only airports whose
// mapped walkways can actually route between security/entrances and a
// meaningful share of gates. Airports with insufficient indoor coverage are
// rejected rather than padded with invented corridors — bundles must contain
// only real mapped data.
//
// Output: public/maps/{IATA}.json bundles + public/maps/index.json catalog.
// Data license: ODbL, © OpenStreetMap contributors (attribution is embedded
// in every bundle and must be shown in the UI).
//
// Usage: node scripts/build-osm-maps.js [IATA ...]

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

// The world's major passenger airports. Airports whose OSM data supports
// corridor routing ship as tier "walkways"; the rest ship real gate/security/
// entrance positions as tier "approximate" (signage-based guidance).
const CANDIDATE_AIRPORTS = [
  // North America
  "ATL", "DFW", "DEN", "ORD", "LAX", "JFK", "LAS", "MCO", "MIA", "CLT",
  "SEA", "PHX", "EWR", "SFO", "IAH", "BOS", "FLL", "MSP", "LGA", "DTW",
  "PHL", "SLC", "BWI", "DCA", "IAD", "SAN", "AUS", "TPA", "BNA", "MDW",
  "HNL", "PDX", "STL", "RDU", "HOU", "SMF", "MSY", "SJC", "SNA", "MCI",
  "OAK", "SAT", "RSW", "CLE", "IND", "PIT", "CVG", "CMH", "JAX", "ANC",
  "YYZ", "YVR", "YUL", "YYC", "YEG", "YOW", "MEX", "CUN", "GDL", "MTY",
  "PTY", "SJU", "SJO",
  // Europe
  "LHR", "CDG", "AMS", "FRA", "IST", "MAD", "BCN", "LGW", "MUC", "FCO",
  "SVO", "DME", "LIS", "ORY", "DUB", "ZRH", "CPH", "PMI", "MAN", "OSL",
  "ARN", "STN", "DUS", "VIE", "BRU", "MXP", "ATH", "HEL", "TXL", "BER",
  "HAM", "GVA", "LYS", "NCE", "PRG", "WAW", "BUD", "OTP", "EDI", "BHX",
  "GLA", "LTN", "KEF", "AGP", "ALC", "OPO", "TLS", "MRS", "STR", "CGN",
  "KRK", "GDN", "RIX", "TLL", "VNO", "SOF", "BEG", "ZAG", "LJU", "SKG",
  // Middle East & Africa
  "DXB", "DOH", "AUH", "JED", "RUH", "TLV", "CAI", "AMM", "KWI", "BAH",
  "MCT", "JNB", "CPT", "NBO", "ADD", "LOS", "CMN", "ALG", "TUN",
  // Asia-Pacific
  "PEK", "PKX", "PVG", "SHA", "CAN", "SZX", "CTU", "KMG", "XIY", "CKG",
  "HKG", "TPE", "ICN", "GMP", "NRT", "HND", "KIX", "ITM", "NGO", "FUK",
  "CTS", "OKA", "SIN", "KUL", "BKK", "DMK", "CGK", "MNL", "SGN", "HAN",
  "DEL", "BOM", "BLR", "MAA", "HYD", "CCU", "CMB", "DAC", "KHI", "LHE",
  "ISB", "KTM", "SYD", "MEL", "BNE", "PER", "ADL", "AKL", "CHC", "WLG",
  "NAN",
  // South America
  "GRU", "GIG", "BSB", "CGH", "SDU", "EZE", "AEP", "SCL", "LIM", "BOG",
  "MDE", "UIO", "CCS", "MVD", "ASU", "VVI", "LPB"
];

// Tier "walkways" requires mapped corridors that genuinely connect the
// airport: enough gates, reachable from security or an entrance. Airports
// below that bar still ship as tier "approximate" when OSM has real gate
// positions to show (no fabricated corridors, signage-based guidance).
const MIN_CONNECTED_GATES = 10;
const MIN_GATE_CONNECTIVITY_RATIO = 0.35;
const MIN_APPROXIMATE_GATES = 5;
const GATE_SNAP_MAX_METERS = 150;
const MAX_AMENITIES = 40;

const catalogOnly = process.argv.includes("--catalog-only");
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--")).map((code) => code.toUpperCase());
const airports = catalogOnly ? [] : args.length ? args : CANDIDATE_AIRPORTS;

function overpassQuery(iata) {
  return `[out:json][timeout:120];
area["iata"="${iata}"]["aeroway"="aerodrome"]->.ap;
(
  node["aeroway"="gate"](area.ap);
  way["highway"~"^(footway|corridor|pedestrian|steps)$"](area.ap);
  way["indoor"~"^(corridor|area|yes)$"](area.ap);
  node["barrier"="security_check"](area.ap);
  way["barrier"="security_check"](area.ap);
  node["entrance"~"^(main|yes)$"](area.ap);
  node["amenity"~"^(restaurant|cafe|fast_food|bar)$"](area.ap);
);
out body;
>;
out skel qt;`;
}

async function fetchOverpass(iata) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(overpassQuery(iata))}`
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!Array.isArray(payload.elements)) throw new Error("Malformed Overpass response");
        return payload.elements;
      } catch (error) {
        lastError = error;
      }
    }
    // Rate limits clear after a pause; one long backoff rescues most 429 runs.
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 45000));
  }
  throw new Error(`All Overpass endpoints failed for ${iata}: ${lastError?.message}`);
}

function haversineMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(s));
}

function firstLevel(tags) {
  const raw = tags?.level ?? "0";
  return String(raw).split(";")[0].trim() || "0";
}

function classifyNode(tags = {}) {
  if (tags.aeroway === "gate") return "gate";
  if (tags.barrier === "security_check") return "security";
  if (tags.entrance === "main" || tags.entrance === "yes") return "arrival";
  if (["restaurant", "cafe", "fast_food", "bar"].includes(tags.amenity)) return "amenity";
  return "junction";
}

function buildAirport(iata, elements) {
  const osmNodes = new Map();
  const ways = [];
  for (const element of elements) {
    if (element.type === "node") osmNodes.set(element.id, element);
    if (element.type === "way" && Array.isArray(element.nodes)) ways.push(element);
  }

  // Graph vertices come from walkway ways; edges connect consecutive way
  // vertices with real haversine distances. Steps are kept but flagged
  // inaccessible so accessible routing avoids them.
  const vertices = new Map();
  const edges = new Map();
  const addVertex = (osmNode, kindTags) => {
    if (!vertices.has(osmNode.id)) {
      vertices.set(osmNode.id, {
        id: `n${osmNode.id}`,
        lat: osmNode.lat,
        lon: osmNode.lon,
        kind: classifyNode(kindTags || osmNode.tags),
        tags: osmNode.tags || {},
        level: firstLevel(osmNode.tags)
      });
    }
    return vertices.get(osmNode.id);
  };

  // Security checkpoints mapped as barrier lines across corridors: their
  // member nodes mark security positions but the barrier itself is not a path.
  const securityWayNodeIds = new Set();
  for (const way of ways) {
    if (way.tags?.barrier === "security_check") {
      for (const nodeId of way.nodes) securityWayNodeIds.add(nodeId);
    }
  }

  for (const way of ways) {
    if (way.tags?.barrier === "security_check") continue;
    if (way.tags?.indoor && !way.tags?.highway && way.tags.indoor !== "corridor") continue;
    const accessible = way.tags?.highway !== "steps";
    const level = firstLevel(way.tags);
    let previous = null;
    for (const nodeId of way.nodes) {
      const osmNode = osmNodes.get(nodeId);
      if (!osmNode || osmNode.lat === undefined) continue;
      const vertex = addVertex(osmNode);
      if (vertex.level === "0" && level !== "0") vertex.level = level;
      if (previous && previous !== vertex) {
        const meters = haversineMeters(previous, vertex);
        if (meters > 0.5) {
          const key = [previous.id, vertex.id].sort().join("::");
          if (!edges.has(key) || (accessible && !edges.get(key).accessible)) {
            edges.set(key, { from: previous.id, to: vertex.id, meters: round1(meters), accessible });
          }
        }
      }
      previous = vertex;
    }
  }

  // Points of interest (gates, security, entrances, amenities) snap onto the
  // nearest walkway vertex; the connector edge length is the real straight-
  // line distance between the mapped point and the mapped walkway.
  // Nodes that belong to a security barrier line become security markers:
  // upgrade in place when they already sit on the walk graph, snap otherwise.
  for (const nodeId of securityWayNodeIds) {
    if (vertices.has(nodeId)) vertices.get(nodeId).kind = "security";
  }

  const pois = [];
  for (const element of elements) {
    if (element.type !== "node" || !element.tags) continue;
    const kind = securityWayNodeIds.has(element.id) ? "security" : classifyNode(element.tags);
    if (kind === "junction" || vertices.has(element.id)) continue;
    pois.push({ ...element, kind });
  }
  for (const nodeId of securityWayNodeIds) {
    if (vertices.has(nodeId) || pois.some((poi) => poi.id === nodeId)) continue;
    const osmNode = osmNodes.get(nodeId);
    if (osmNode?.lat !== undefined) pois.push({ ...osmNode, kind: "security", tags: osmNode.tags || {} });
  }

  const walkVertices = [...vertices.values()];
  if (!walkVertices.length) return buildGateLocations(iata, elements, "no mapped walkways");

  const snapped = [];
  for (const poi of pois) {
    let best = null;
    let bestMeters = Infinity;
    for (const vertex of walkVertices) {
      const meters = haversineMeters(poi, vertex);
      if (meters < bestMeters) {
        best = vertex;
        bestMeters = meters;
      }
    }
    if (!best || bestMeters > GATE_SNAP_MAX_METERS) continue;
    const vertex = {
      id: `n${poi.id}`,
      lat: poi.lat,
      lon: poi.lon,
      kind: poi.kind,
      tags: poi.tags,
      level: firstLevel(poi.tags)
    };
    vertices.set(poi.id, vertex);
    const key = [vertex.id, best.id].sort().join("::");
    edges.set(key, { from: vertex.id, to: best.id, meters: round1(Math.max(bestMeters, 1)), accessible: true });
    snapped.push(vertex);
  }

  // Connectivity: keep the component that contains the most gates, and
  // require it to include security or an entrance plus a critical mass of
  // gates — otherwise the mapped data cannot honestly route this airport.
  const adjacency = new Map();
  for (const vertex of vertices.values()) adjacency.set(vertex.id, []);
  for (const edge of edges.values()) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const componentOf = new Map();
  let componentIndex = 0;
  for (const vertex of vertices.values()) {
    if (componentOf.has(vertex.id)) continue;
    const queue = [vertex.id];
    componentOf.set(vertex.id, componentIndex);
    while (queue.length) {
      const current = queue.pop();
      for (const next of adjacency.get(current) || []) {
        if (!componentOf.has(next)) {
          componentOf.set(next, componentIndex);
          queue.push(next);
        }
      }
    }
    componentIndex += 1;
  }

  const gateVertices = [...vertices.values()].filter((vertex) => vertex.kind === "gate");
  const totalGates = gateVertices.length + pois.filter((p) => p.kind === "gate" && !vertices.has(p.id)).length;
  const gatesPerComponent = new Map();
  for (const gate of gateVertices) {
    const component = componentOf.get(gate.id);
    gatesPerComponent.set(component, (gatesPerComponent.get(component) || 0) + 1);
  }
  const [mainComponent, connectedGates] = [...gatesPerComponent.entries()]
    .sort((a, b) => b[1] - a[1])[0] || [null, 0];

  if (connectedGates < MIN_CONNECTED_GATES) {
    return buildGateLocations(iata, elements, `only ${connectedGates} gates routable over mapped walkways`);
  }
  if (totalGates && connectedGates / totalGates < MIN_GATE_CONNECTIVITY_RATIO) {
    return buildGateLocations(iata, elements, `walkways reach ${connectedGates}/${totalGates} gates — coverage too sparse`);
  }

  const kept = [...vertices.values()].filter((vertex) => componentOf.get(vertex.id) === mainComponent);
  const keptIds = new Set(kept.map((vertex) => vertex.id));
  const hasAnchor = kept.some((vertex) => vertex.kind === "security" || vertex.kind === "arrival");
  if (!hasAnchor) {
    return buildGateLocations(iata, elements, "no security checkpoint or main entrance on the routable network");
  }

  const keptEdges = [...edges.values()].filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to));
  return emitBundle(iata, kept, keptEdges, "walkways", { gates: connectedGates, totalGates });
}

// Tier "approximate": real gate/security/entrance/amenity positions only, no
// edges — the client gives signage-based guidance with approximate distances
// instead of pretending to know corridors that are not mapped.
function buildGateLocations(iata, elements, walkwayReason) {
  const seen = new Set();
  const points = [];
  for (const element of elements) {
    if (element.type !== "node" || !element.tags || element.lat === undefined) continue;
    const kind = classifyNode(element.tags);
    if (kind === "junction" || seen.has(element.id)) continue;
    seen.add(element.id);
    points.push({
      id: `n${element.id}`,
      lat: element.lat,
      lon: element.lon,
      kind,
      tags: element.tags,
      level: firstLevel(element.tags)
    });
  }

  const gates = points.filter((point) => point.kind === "gate");
  if (gates.length < MIN_APPROXIMATE_GATES) {
    return { rejected: `${walkwayReason}; only ${gates.length} mapped gate position(s)` };
  }

  return emitBundle(iata, points, [], "approximate", { gates: gates.length, totalGates: gates.length });
}

function emitBundle(iata, kept, keptEdges, routing, gateStats) {
  // Project lat/lon to local meters (equirectangular, y flipped for SVG).
  const latRef = kept.reduce((sum, v) => sum + v.lat, 0) / kept.length;
  const metersPerDegLon = 111320 * Math.cos((latRef * Math.PI) / 180);
  const minLon = Math.min(...kept.map((v) => v.lon));
  const maxLat = Math.max(...kept.map((v) => v.lat));

  const nodes = kept.map((vertex) => ({
    id: vertex.id,
    floorId: `L${vertex.level}`,
    x: round1((vertex.lon - minLon) * metersPerDegLon),
    y: round1((maxLat - vertex.lat) * 110540),
    kind: vertex.kind,
    label: vertex.kind === "gate"
      ? (vertex.tags.ref || vertex.tags.name || "Gate")
      : vertex.kind === "security"
        ? (vertex.tags.name || "Security")
        : vertex.kind === "arrival"
          ? (vertex.tags.name || "Entrance")
          : (vertex.tags.name || "")
  }));

  const amenityNodes = nodes.filter((node) => node.kind === "amenity" && node.label);
  const places = [
    ...nodes.filter((node) => node.kind === "gate").map((node) => ({ id: node.id, kind: "gate", label: node.label, nodeId: node.id })),
    ...nodes.filter((node) => node.kind === "security").map((node) => ({ id: node.id, kind: "security", label: node.label, nodeId: node.id })),
    ...nodes.filter((node) => node.kind === "arrival").map((node) => ({ id: node.id, kind: "arrival", label: node.label, nodeId: node.id })),
    ...amenityNodes.slice(0, MAX_AMENITIES).map((node) => ({ id: node.id, kind: "amenity", label: node.label, nodeId: node.id }))
  ];

  const levels = [...new Set(nodes.map((node) => node.floorId))].sort();
  const version = `${new Date().toISOString().slice(0, 10)}-osm`;

  return {
    map: {
      airportCode: iata,
      name: routing === "walkways"
        ? `${iata} (OpenStreetMap indoor data)`
        : `${iata} (OpenStreetMap gate positions)`,
      version,
      source: "openstreetmap-indoor",
      attribution: "Map data © OpenStreetMap contributors, ODbL",
      routing,
      scale: { unit: "meter", pixelsPerMeter: 1 },
      floors: levels.map((id) => ({ id, label: `Level ${id.slice(1)}` })),
      nodes,
      edges: keptEdges,
      places,
      closures: []
    },
    stats: { ...gateStats, nodes: nodes.length, edges: keptEdges.length, routing }
  };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

await mkdir("public/maps", { recursive: true });
const catalogEntries = [];
const rejected = [];

for (const iata of airports) {
  process.stdout.write(`${iata}: querying Overpass... `);
  try {
    const elements = await fetchOverpass(iata);
    const result = buildAirport(iata, elements);
    if (result.rejected) {
      rejected.push(`${iata}: ${result.rejected}`);
      console.log(`rejected (${result.rejected})`);
    } else {
      await writeFile(
        `public/maps/${iata}.json`,
        JSON.stringify({
          format: "gate-guide-airport-map",
          source: "openstreetmap-indoor",
          version: result.map.version,
          updatedAt: new Date().toISOString(),
          attribution: result.map.attribution,
          routing: result.map.routing,
          map: result.map
        })
      );
      catalogEntries.push({ airportCode: iata });
      const { stats } = result;
      console.log(`ok [${stats.routing}] (${stats.gates}/${stats.totalGates} gates, ${stats.nodes} nodes, ${stats.edges} edges)`);
    }
  } catch (error) {
    rejected.push(`${iata}: ${error.message}`);
    console.log(`failed (${error.message})`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

// The catalog always reflects every bundle on disk, so partial reruns for a
// subset of airports never drop previously built entries.
const allEntries = [];
for (const file of (await readdir("public/maps")).sort()) {
  const match = file.match(/^([A-Z0-9]{3,4})\.json$/);
  if (!match) continue;
  const payload = JSON.parse(await readFile(`public/maps/${file}`, "utf8"));
  allEntries.push({
    airportCode: match[1],
    bundleUrl: `/maps/${match[1]}.json`,
    format: payload.format || "gate-guide-airport-map",
    version: payload.version || null,
    updatedAt: payload.updatedAt || null,
    source: payload.source || "openstreetmap-indoor",
    routing: payload.routing || payload.map?.routing || "walkways"
  });
}

await writeFile(
  "public/maps/index.json",
  JSON.stringify({
    source: "openstreetmap-indoor",
    version: new Date().toISOString().slice(0, 10),
    attribution: "Map data © OpenStreetMap contributors, ODbL",
    entries: allEntries
  }, null, 2)
);

console.log(`\nBuilt ${catalogEntries.length} airport bundle(s) this run (${allEntries.length} total on disk); rejected ${rejected.length}.`);
if (rejected.length) console.log(rejected.map((line) => `  - ${line}`).join("\n"));
