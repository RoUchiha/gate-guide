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
