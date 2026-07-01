import test from "node:test";
import assert from "node:assert/strict";
import { MockFlightProvider, summarizeConnectionRisk } from "../public/app-assets/flight-provider.js";

test("resolves flight itinerary with source and gate", async () => {
  const provider = new MockFlightProvider(() => new Date("2026-06-30T18:00:00Z"));
  const itinerary = await provider.resolveFlight({ airline: "AA", flightNumber: "1442", date: "2026-07-01" });
  assert.equal(itinerary.source, "MockFlightProvider");
  assert.equal(itinerary.legs[0].gate, "A18");
  assert.equal(itinerary.legs[0].fetchedAt, "2026-06-30T18:00:00.000Z");
});

test("simulates gate change without mutating original itinerary", async () => {
  const provider = new MockFlightProvider(() => new Date("2026-06-30T18:00:00Z"));
  const itinerary = await provider.resolveFlight({ airline: "AA", flightNumber: "1442", date: "2026-07-01" });
  const changed = provider.simulateGateChange(itinerary, "A21");
  assert.equal(itinerary.legs[0].gate, "A18");
  assert.equal(changed.legs[0].gate, "A21");
  assert.equal(changed.legs[0].status, "gate changed");
});

test("summarizes layover risk", () => {
  const itinerary = {
    legs: [
      { estimatedDeparture: "2026-07-01T15:40:00-07:00" },
      { estimatedDeparture: "2026-07-01T16:05:00-07:00" }
    ]
  };
  const risk = summarizeConnectionRisk(itinerary, 45);
  assert.equal(risk.atRisk, true);
  assert.equal(risk.bufferMinutes, 25);
});
