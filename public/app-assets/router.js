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

export function routeBetween(map, fromNodeId, toNodeId, options = {}) {
  const accessible = Boolean(options.accessible);
  const now = options.now || new Date();
  const graph = new Map(map.nodes.map((node) => [node.id, []]));

  if (!graph.has(fromNodeId) || !graph.has(toNodeId)) {
    return {
      ok: false,
      reason: "Start or destination is not on the loaded map",
      path: [],
      meters: 0,
      etaMinutes: null,
      steps: []
    };
  }

  for (const edge of map.edges) {
    if (accessible && !edge.accessible) continue;
    if (isEdgeClosed(map, edge.from, edge.to, now)) continue;
    graph.get(edge.from).push({ to: edge.to, meters: edge.meters });
    graph.get(edge.to).push({ to: edge.from, meters: edge.meters });
  }

  const distances = new Map(map.nodes.map((node) => [node.id, Infinity]));
  const previous = new Map();
  const unvisited = new Set(map.nodes.map((node) => node.id));
  distances.set(fromNodeId, 0);

  while (unvisited.size) {
    let current = null;
    let currentDistance = Infinity;
    for (const nodeId of unvisited) {
      const distance = distances.get(nodeId);
      if (distance < currentDistance) {
        current = nodeId;
        currentDistance = distance;
      }
    }

    if (current === null || currentDistance === Infinity) break;
    if (current === toNodeId) break;
    unvisited.delete(current);

    for (const neighbor of graph.get(current)) {
      if (!unvisited.has(neighbor.to)) continue;
      const nextDistance = currentDistance + neighbor.meters;
      if (nextDistance < distances.get(neighbor.to)) {
        distances.set(neighbor.to, nextDistance);
        previous.set(neighbor.to, current);
      }
    }
  }

  if (distances.get(toNodeId) === Infinity) {
    return {
      ok: false,
      reason: "No route available with current closures and accessibility settings",
      path: [],
      meters: 0,
      etaMinutes: null,
      steps: []
    };
  }

  const path = [];
  let cursor = toNodeId;
  while (cursor) {
    path.unshift(cursor);
    cursor = previous.get(cursor);
  }

  const meters = distances.get(toNodeId);
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

function buildSteps(map, path, meters, etaMinutes) {
  if (path.length < 2) return [];
  const nodes = path.map((nodeId) => getNode(map, nodeId));
  const startLabel = nodes[0].label || "your current position";
  const destination = nodes.at(-1).label || "your gate";

  // Only labeled waypoints make useful instructions; large real-world graphs
  // have hundreds of anonymous junction vertices per route, so sample down to
  // a handful of named landmarks along the way.
  const waypoints = [];
  for (const node of nodes.slice(1, -1)) {
    const label = node.label;
    if (!label || label === startLabel || label === destination) continue;
    if (waypoints.at(-1) !== label) waypoints.push(label);
  }
  const stride = Math.max(1, Math.ceil(waypoints.length / 5));
  const sampled = waypoints.filter((_, index) => index % stride === 0).slice(0, 5);

  return [
    `Start at ${startLabel} and follow the signed concourse route.`,
    ...sampled.map((label) => `Continue toward ${label}.`),
    `Arrive at ${destination}. Estimated walk ${Math.round(meters)} m, about ${etaMinutes} min.`
  ];
}
