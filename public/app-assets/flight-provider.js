export class MockFlightProvider {
  constructor(clock = () => new Date()) {
    this.clock = clock;
  }

  async resolveFlight({ airline, flightNumber, date }) {
    const fetchedAt = this.clock().toISOString();
    return {
      itineraryId: `${airline}${flightNumber}-${date}`,
      source: "MockFlightProvider",
      fetchedAt,
      legs: [
        {
          id: "leg-1",
          airline,
          flightNumber,
          date,
          origin: "DFW",
          destination: "LAX",
          terminal: "A",
          gate: "A18",
          status: "boarding soon",
          scheduledDeparture: `${date}T15:25:00-05:00`,
          estimatedDeparture: `${date}T15:40:00-05:00`,
          scheduledArrival: `${date}T16:35:00-07:00`,
          estimatedArrival: `${date}T16:50:00-07:00`,
          fetchedAt,
          source: "MockFlightProvider"
        },
        {
          id: "leg-2",
          airline: "AA",
          flightNumber: "2207",
          date,
          origin: "LAX",
          destination: "SEA",
          terminal: "4",
          gate: "A21",
          status: "on time",
          scheduledDeparture: `${date}T18:15:00-07:00`,
          estimatedDeparture: `${date}T18:15:00-07:00`,
          scheduledArrival: `${date}T21:05:00-07:00`,
          estimatedArrival: `${date}T21:05:00-07:00`,
          fetchedAt,
          source: "MockFlightProvider"
        }
      ]
    };
  }

  simulateGateChange(itinerary, gate = "A21") {
    const next = structuredClone(itinerary);
    next.fetchedAt = this.clock().toISOString();
    next.legs[0].gate = gate;
    next.legs[0].status = "gate changed";
    next.legs[0].fetchedAt = next.fetchedAt;
    return next;
  }
}

export class ApiFlightProvider {
  constructor(fallback = new MockFlightProvider()) {
    this.fallback = fallback;
  }

  async resolveFlight({ airline, flightNumber, date }, { allowDemoFallback = true } = {}) {
    const url = new URL("/api/flight", window.location.origin);
    url.searchParams.set("airline", airline);
    url.searchParams.set("flightNumber", flightNumber);
    url.searchParams.set("date", date);

    try {
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error || "Flight provider request failed.");
        error.productionRequired = Boolean(payload.productionRequired);
        throw error;
      }
      return payload;
    } catch (error) {
      // When the server runs in live-flights mode, fabricated demo data must
      // never stand in for a real itinerary.
      if (error.productionRequired || !allowDemoFallback) throw error;
      const itinerary = await this.fallback.resolveFlight({ airline, flightNumber, date });
      return {
        ...itinerary,
        providerMode: "demo",
        warnings: [`Live flight provider unavailable: ${error.message}`]
      };
    }
  }

  simulateGateChange(itinerary, gate = "A21") {
    if (itinerary?.providerMode === "live") return itinerary;
    return this.fallback.simulateGateChange(itinerary, gate);
  }
}

export function summarizeConnectionRisk(itinerary, minimumMinutes = 45) {
  if (!itinerary?.legs || itinerary.legs.length < 2) return null;
  const [arrivalLeg, departureLeg] = itinerary.legs;
  // The layover buffer runs from when the first leg lands to when the next
  // leg departs; fall back to departure times only if no arrival is known.
  const arrival = new Date(
    arrivalLeg.estimatedArrival
    || arrivalLeg.scheduledArrival
    || arrivalLeg.estimatedDeparture
    || arrivalLeg.scheduledDeparture
  );
  const departure = new Date(departureLeg.estimatedDeparture || departureLeg.scheduledDeparture);
  const bufferMinutes = Math.round((departure - arrival) / 60000);
  if (!Number.isFinite(bufferMinutes)) return null;
  return {
    bufferMinutes,
    minimumMinutes,
    atRisk: bufferMinutes < minimumMinutes,
    message: bufferMinutes < minimumMinutes
      ? `Connection risk: ${bufferMinutes} min buffer, below ${minimumMinutes} min.`
      : `Connection buffer: ${bufferMinutes} min.`
  };
}
