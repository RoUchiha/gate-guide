export function edgeKey(a, b) {
  return [a, b].sort().join("::");
}

export function getNode(map, nodeId) {
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown map node: ${nodeId}`);
  return node;
}

export function placeToNode(map, placeIdOrLabel) {
  const normalized = placeIdOrLabel.toLowerCase();
  const place = map.places.find((candidate) => {
    return candidate.id.toLowerCase() === normalized || candidate.label.toLowerCase() === normalized;
  });
  if (!place) throw new Error(`Unknown map place: ${placeIdOrLabel}`);
  return place.nodeId;
}

export function isEdgeClosed(map, from, to, now = new Date()) {
  const key = edgeKey(from, to);
  return map.closures?.some((closure) => {
    if (closure.edgeKey !== key) return false;
    return !closure.until || new Date(closure.until) > now;
  }) || false;
}

// Binary min-heap keyed on distance — Dijkstra stays fast on real airport
// graphs with thousands of vertices.
class MinHeap {
  constructor() {
    this.items = [];
  }

  push(distance, nodeId) {
    const items = this.items;
    items.push([distance, nodeId]);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent][0] <= items[index][0]) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    if (!items.length) return null;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
        if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index], items[smallest]];
        index = smallest;
      }
    }
    return top;
  }
}

function noRoute(reason) {
  return { ok: false, reason, path: [], meters: 0, etaMinutes: null, steps: [] };
}

function shortestPath(map, graph, fromNodeId, toNodeId) {
  const distances = new Map();
  const previous = new Map();
  const settled = new Set();
  const heap = new MinHeap();
  distances.set(fromNodeId, 0);
  heap.push(0, fromNodeId);

  while (true) {
    const entry = heap.pop();
    if (!entry) break;
    const [distance, current] = entry;
    if (settled.has(current)) continue;
    settled.add(current);
    if (current === toNodeId) break;
    for (const neighbor of graph.get(current) || []) {
      if (settled.has(neighbor.to)) continue;
      const next = distance + neighbor.meters;
      if (next < (distances.get(neighbor.to) ?? Infinity)) {
        distances.set(neighbor.to, next);
        previous.set(neighbor.to, current);
        heap.push(next, neighbor.to);
      }
    }
  }

  if (!distances.has(toNodeId) || distances.get(toNodeId) === Infinity) return null;
  const path = [];
  let cursor = toNodeId;
  while (cursor !== undefined) {
    path.unshift(cursor);
    cursor = previous.get(cursor);
  }
  return { path, meters: distances.get(toNodeId) };
}

export function routeBetween(map, fromNodeId, toNodeId, options = {}) {
  const accessible = Boolean(options.accessible);
  const now = options.now || new Date();
  const graph = new Map(map.nodes.map((node) => [node.id, []]));

  if (!graph.has(fromNodeId) || !graph.has(toNodeId)) {
    return noRoute("Start or destination is not on the loaded map");
  }

  for (const edge of map.edges) {
    if (accessible && !edge.accessible) continue;
    if (isEdgeClosed(map, edge.from, edge.to, now)) continue;
    graph.get(edge.from).push({ to: edge.to, meters: edge.meters });
    graph.get(edge.to).push({ to: edge.from, meters: edge.meters });
  }

  // Landside starts route through the security checkpoint: a leg to the via
  // node, then onward — merged into one itinerary.
  let legs;
  if (options.via && graph.has(options.via) && options.via !== fromNodeId && options.via !== toNodeId) {
    const first = shortestPath(map, graph, fromNodeId, options.via);
    const second = first && shortestPath(map, graph, options.via, toNodeId);
    legs = first && second
      ? { path: [...first.path, ...second.path.slice(1)], meters: first.meters + second.meters }
      : null;
    if (!legs) legs = shortestPath(map, graph, fromNodeId, toNodeId);
  } else {
    legs = shortestPath(map, graph, fromNodeId, toNodeId);
  }

  if (!legs) {
    return noRoute("No route available with current closures and accessibility settings");
  }

  const { path, meters } = legs;
  const etaMinutes = Math.max(1, Math.ceil(meters / (options.metersPerMinute || 72)));

  return {
    ok: true,
    routeId: `${fromNodeId}-${toNodeId}-${map.version}`,
    mapVersion: map.version,
    fromNodeId,
    toNodeId,
    path,
    meters,
    etaMinutes,
    confidence: options.positionConfidence || "medium",
    steps: buildSteps(map, path, meters, etaMinutes)
  };
}

export function nearestNode(map, reading) {
  const sameFloor = map.nodes.filter((node) => !reading.floorId || node.floorId === reading.floorId);
  const candidates = sameFloor.length ? sameFloor : map.nodes;
  return candidates.reduce((best, node) => {
    const distance = Math.hypot(node.x - reading.x, node.y - reading.y);
    return distance < best.distance ? { node, distance } : best;
  }, { node: null, distance: Infinity }).node;
}

export function formatDistance(meters) {
  return meters >= 950
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.max(5, Math.round(meters / 5) * 5)} m`;
}

function bearing(from, to) {
  return (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
}

function turnDirection(delta) {
  const normalized = ((delta + 540) % 360) - 180;
  if (normalized <= -35) return normalized <= -110 ? "Make a sharp left" : "Turn left";
  if (normalized >= 35) return normalized >= 110 ? "Make a sharp right" : "Turn right";
  return null;
}

// Turn-by-turn instructions derived from the real path geometry: significant
// bearing changes become turns, floor changes become level transitions, and
// notable places along the way anchor the directions.
function buildSteps(map, path, meters, etaMinutes) {
  if (path.length < 2) return [];
  const nodes = path.map((nodeId) => getNode(map, nodeId));
  const destination = nodes.at(-1).label || "your gate";
  const pxPerMeter = map.scale?.pixelsPerMeter || 1;
  const segmentMeters = (i) => Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].y - nodes[i].y) / pxPerMeter;

  // Level tags on real-world data are noisy node to node; a floor change is
  // only announced when the new level persists for a meaningful stretch.
  const floorPersistence = (start, floor) => {
    let held = 0;
    for (let j = start; j < nodes.length - 1 && nodes[j].floorId === floor; j += 1) held += segmentMeters(j);
    return held;
  };

  // Collect events (turns, level changes, landmarks) with the distance
  // walked since the previous event.
  const events = [];
  let sinceLast = 0;
  let currentFloor = nodes[0].floorId || null;
  for (let i = 1; i < nodes.length - 1; i += 1) {
    sinceLast += segmentMeters(i - 1);
    const node = nodes[i];

    const nextFloor = nodes[i + 1].floorId;
    if (currentFloor && nextFloor && nextFloor !== currentFloor
      && (floorPersistence(i + 1, nextFloor) >= 60 || i + 1 === nodes.length - 1)) {
      const how = node.kind === "elevator" ? "take the elevator" : "take the stairs or escalator";
      events.push({ distance: sinceLast, text: `${how} to ${floorLabel(map, nextFloor)}`, weight: 1000 });
      currentFloor = nextFloor;
      sinceLast = 0;
      continue;
    }

    if (node.kind === "security") {
      events.push({ distance: sinceLast, text: `go through ${node.label || "the security checkpoint"}`, weight: 1000 });
      sinceLast = 0;
      continue;
    }

    const delta = bearing(nodes[i], nodes[i + 1]) - bearing(nodes[i - 1], nodes[i]);
    const turn = turnDirection(delta);
    if (turn) {
      const at = node.label ? ` at ${node.label}` : "";
      const magnitude = Math.abs(((delta + 540) % 360) - 180);
      events.push({ distance: sinceLast, text: `${turn.toLowerCase()}${at}`, weight: magnitude + sinceLast / 10 });
      sinceLast = 0;
    }
  }
  sinceLast += segmentMeters(nodes.length - 2);

  // Keep the itinerary readable: prioritize mandatory events (security,
  // levels) and the most significant turns.
  const MAX_STEPS = 8;
  let kept = events;
  if (events.length > MAX_STEPS) {
    const threshold = [...events].sort((a, b) => b.weight - a.weight)[MAX_STEPS - 1].weight;
    let merged = 0;
    kept = events.filter((event) => {
      if (event.weight >= threshold) {
        event.distance += merged;
        merged = 0;
        return true;
      }
      merged += event.distance;
      return false;
    });
    sinceLast += merged;
  }

  const steps = [`Head toward ${kept[0] ? "the concourse" : destination}, following signs for gate ${destination}.`];
  for (const event of kept) {
    steps.push(`Walk ${formatDistance(event.distance)}, then ${event.text}.`);
  }
  steps.push(`Continue ${formatDistance(sinceLast)} to arrive at ${destination} — ${formatDistance(meters)}, about ${etaMinutes} min in total.`);
  return steps;
}

function floorLabel(map, floorId) {
  return map.floors?.find((floor) => floor.id === floorId)?.label || floorId;
}
