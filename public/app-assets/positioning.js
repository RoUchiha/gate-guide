export function confidenceForReading(reading, corridorWidthMeters = 18) {
  if (!reading) return "manual";
  if (reading.floorUncertain) return "low";
  if (reading.accuracyMeters <= corridorWidthMeters / 2) return "high";
  if (reading.accuracyMeters <= corridorWidthMeters * 1.5) return "medium";
  return "low";
}

export function browserGpsReading(position) {
  return {
    source: "gps",
    lat: position.coords.latitude,
    lon: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
    timestamp: new Date(position.timestamp).toISOString()
  };
}

export function manualReading(node) {
  return {
    source: "manual",
    floorId: node.floorId,
    x: node.x,
    y: node.y,
    accuracyMeters: 3,
    timestamp: new Date().toISOString()
  };
}

// Projects a GPS fix into the map's local meter grid using the bundle's
// geographic origin. Returns null when the fix is clearly outside the
// airport — an honest "you are not here yet" beats a fabricated position.
export function projectGpsToMap(reading, map, maxOutsideMeters = 2500) {
  if (!map.origin || reading.lat === undefined || reading.lon === undefined) {
    return projectOutdoorGpsToTerminal(reading, map);
  }

  const ppm = map.scale?.pixelsPerMeter || 1;
  const x = (reading.lon - map.origin.minLon) * map.origin.metersPerDegLon * ppm;
  const y = (map.origin.maxLat - reading.lat) * 110540 * ppm;

  const xs = map.nodes.map((node) => node.x);
  const ys = map.nodes.map((node) => node.y);
  const margin = maxOutsideMeters * ppm;
  const inside = x > Math.min(...xs) - margin && x < Math.max(...xs) + margin
    && y > Math.min(...ys) - margin && y < Math.max(...ys) + margin;
  if (!inside) return null;

  return {
    ...reading,
    x,
    y,
    floorUncertain: true
  };
}

// Legacy fallback for bundles without a geographic origin (demo data):
// anchors to the security checkpoint rather than pretending to know better.
export function projectOutdoorGpsToTerminal(reading, map) {
  const anchor = map.nodes.find((node) => node.kind === "security") || map.nodes[0];
  return {
    ...reading,
    floorId: anchor.floorId,
    x: anchor.x,
    y: anchor.y,
    floorUncertain: true
  };
}
