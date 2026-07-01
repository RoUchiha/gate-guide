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
