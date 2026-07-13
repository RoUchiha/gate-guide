import test from "node:test";
import assert from "node:assert/strict";
import { confidenceForReading, manualReading, projectOutdoorGpsToTerminal } from "../public/app-assets/positioning.js";
import { demoAirportMap } from "../public/app-assets/sample-data.js";

test("classifies positioning confidence by accuracy and floor certainty", () => {
  assert.equal(confidenceForReading({ accuracyMeters: 5 }), "high");
  assert.equal(confidenceForReading({ accuracyMeters: 20 }), "medium");
  assert.equal(confidenceForReading({ accuracyMeters: 80 }), "low");
  assert.equal(confidenceForReading({ accuracyMeters: 5, floorUncertain: true }), "low");
});

test("manual reading uses selected map node", () => {
  const node = demoAirportMap.nodes.find((candidate) => candidate.id === "security-a");
  const reading = manualReading(node);
  assert.equal(reading.source, "manual");
  assert.equal(reading.x, node.x);
  assert.equal(reading.accuracyMeters, 3);
});

test("outdoor gps projection marks floor uncertain", () => {
  const reading = projectOutdoorGpsToTerminal({ source: "gps", accuracyMeters: 34 }, demoAirportMap);
  assert.equal(reading.floorUncertain, true);
  assert.equal(reading.floorId, "F1");
});

test("GPS fixes project onto maps with a geographic origin", async () => {
  const { projectGpsToMap } = await import("../public/app-assets/positioning.js");
  const map = {
    origin: { minLon: 4.75, maxLat: 52.32, metersPerDegLon: 68000 },
    scale: { unit: "meter", pixelsPerMeter: 1 },
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1000, y: 800 }
    ]
  };

  // A fix 340 m east and 221 m south of the origin.
  const reading = projectGpsToMap(
    { lat: 52.318, lon: 4.755, accuracyMeters: 12 },
    map
  );
  assert.ok(reading);
  assert.ok(Math.abs(reading.x - 340) < 1, `x=${reading.x}`);
  assert.ok(Math.abs(reading.y - 221.08) < 1, `y=${reading.y}`);
  assert.equal(reading.floorUncertain, true);

  // A fix in another city is rejected, not fabricated.
  const far = projectGpsToMap({ lat: 48.85, lon: 2.35, accuracyMeters: 12 }, map);
  assert.equal(far, null);
});
