import { demoAirportMap } from "../public/app-assets/sample-data.js";
import { MockFlightProvider } from "../public/app-assets/flight-provider.js";

const flightAwareBaseUrl = "https://aeroapi.flightaware.com/aeroapi";

export function providerStatus(env = process.env) {
  const productionMapsRequired = requiresProductionMaps(env);
  return {
    flight: env.FLIGHTAWARE_AEROAPI_KEY ? "flightaware-aeroapi" : "demo",
    airportMap: mapProviderName(env),
    productionMapsRequired,
    wifi: "client-native-bridge-or-manual"
  };
}

export async function resolveFlightFromProviders(query, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;

  if (env.FLIGHTAWARE_AEROAPI_KEY) {
    return resolveFlightAware(query, { env, fetchImpl });
  }

  const provider = new MockFlightProvider();
  const itinerary = await provider.resolveFlight(query);
  return {
    ...itinerary,
    providerMode: "demo",
    warnings: ["Set FLIGHTAWARE_AEROAPI_KEY to use live flight status and gate data."]
  };
}

export async function resolveAirportMapFromProviders(airportCode, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const normalizedAirport = String(airportCode || "DFW").trim().toUpperCase();
  const productionMapsRequired = requiresProductionMaps(env);

  if (env.AIRPORT_MAP_CATALOG_URL || env.AIRPORT_MAP_BUNDLE_BASE_URL) {
    const catalog = await resolveAirportMapCatalog({ env, fetchImpl });
    const entry = findCatalogEntry(catalog, normalizedAirport);

    if (!entry) {
      throw httpError(404, `No production map bundle is registered for ${normalizedAirport}.`, {
        productionRequired: productionMapsRequired
      });
    }

    const response = await fetchImpl(entry.bundleUrl, { headers: mapHeaders(env) });

    if (!response.ok) {
      throw httpError(response.status, `Map bundle request failed for ${normalizedAirport}.`, {
        productionRequired: productionMapsRequired
      });
    }

    const payload = await response.json();
    const { map, provenance } = normalizeMapPayload(payload, entry);
    const diagnostics = validateAirportMap(map, { production: true });
    return {
      providerMode: "production",
      source: catalog.source,
      fetchedAt: new Date().toISOString(),
      provenance,
      diagnostics,
      map
    };
  }

  if (productionMapsRequired) {
    throw httpError(503, "Production maps are required but no production map provider is configured.", {
      productionRequired: true
    });
  }

  const diagnostics = validateAirportMap(demoAirportMap, { production: false });
  return {
    providerMode: "demo",
    source: "demo-bundle",
    fetchedAt: new Date().toISOString(),
    warnings: ["Set AIRPORT_MAP_BUNDLE_BASE_URL to load airport-approved map bundles."],
    diagnostics,
    map: demoAirportMap
  };
}

export async function resolveAirportMapCatalog(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const token = env.AIRPORT_MAP_BUNDLE_TOKEN;

  if (env.AIRPORT_MAP_CATALOG_URL) {
    const response = await fetchImpl(env.AIRPORT_MAP_CATALOG_URL, { headers: mapHeaders(env) });
    if (!response.ok) throw httpError(response.status, "Airport map catalog request failed.");
    const catalog = await response.json();
    return normalizeCatalog(catalog, env.AIRPORT_MAP_CATALOG_URL);
  }

  if (env.AIRPORT_MAP_BUNDLE_BASE_URL) {
    const baseUrl = env.AIRPORT_MAP_BUNDLE_BASE_URL.replace(/\/+$/, "");
    const indexUrl = `${baseUrl}/index.json`;
    const response = await fetchImpl(indexUrl, { headers: mapHeaders(env) });
    if (response.ok) {
      const catalog = await response.json();
      return normalizeCatalog(catalog, indexUrl);
    }

    return {
      source: "production-bundle-base",
      fetchedAt: new Date().toISOString(),
      entries: ["DFW", "LAX", "ORD", "ATL", "JFK", "SFO", "SEA", "DEN", "MIA", "BOS"].map((airportCode) => ({
        airportCode,
        bundleUrl: `${baseUrl}/${airportCode}.json`,
        format: "gate-guide-airport-map",
        source: "production-bundle-base",
        tokenProtected: Boolean(token)
      }))
    };
  }

  return {
    source: "demo",
    fetchedAt: new Date().toISOString(),
    entries: [{
      airportCode: demoAirportMap.airportCode,
      bundleUrl: "/api/airport-map?airport=DFW",
      format: "gate-guide-airport-map",
      source: "demo"
    }]
  };
}

function mapProviderName(env) {
  if (env.AIRPORT_MAP_CATALOG_URL) return "production-map-catalog";
  if (env.AIRPORT_MAP_BUNDLE_BASE_URL) return "production-map-bundles";
  if (requiresProductionMaps(env)) return "missing-production-map-provider";
  return "demo";
}

function requiresProductionMaps(env) {
  return env.GATE_GUIDE_MAP_MODE === "production" || env.REQUIRE_PRODUCTION_MAPS === "true";
}

function mapHeaders(env) {
  return env.AIRPORT_MAP_BUNDLE_TOKEN
    ? { authorization: `Bearer ${env.AIRPORT_MAP_BUNDLE_TOKEN}` }
    : {};
}

function normalizeCatalog(catalog, sourceUrl) {
  const entries = Array.isArray(catalog.entries)
    ? catalog.entries
    : Array.isArray(catalog.airports)
      ? catalog.airports
      : [];

  return {
    source: catalog.source || "production-map-catalog",
    version: catalog.version || null,
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    entries: entries.map((entry) => ({
      airportCode: String(entry.airportCode || entry.iata || entry.code || "").toUpperCase(),
      bundleUrl: entry.bundleUrl || entry.url,
      format: entry.format || "gate-guide-airport-map",
      version: entry.version || null,
      updatedAt: entry.updatedAt || null,
      source: entry.source || catalog.source || "production-map-catalog",
      checksum: entry.checksum || null,
      accuracy: entry.accuracy || null
    })).filter((entry) => entry.airportCode && entry.bundleUrl)
  };
}

function findCatalogEntry(catalog, airportCode) {
  return catalog.entries.find((entry) => entry.airportCode === airportCode);
}

function normalizeMapPayload(payload, entry) {
  const map = payload.map || payload;
  const provenance = {
    format: payload.format || entry.format,
    source: payload.source || entry.source,
    version: payload.version || map.version || entry.version,
    updatedAt: payload.updatedAt || entry.updatedAt,
    checksum: payload.checksum || entry.checksum,
    accuracy: payload.accuracy || entry.accuracy,
    bundleUrl: entry.bundleUrl
  };
  return { map, provenance };
}

async function resolveFlightAware({ airline, flightNumber, date }, { env, fetchImpl }) {
  const ident = `${String(airline || "").trim().toUpperCase()}${String(flightNumber || "").trim()}`;
  if (!ident || ident.length < 3) {
    throw httpError(400, "Airline and flight number are required.");
  }

  const requestUrl = new URL(`${flightAwareBaseUrl}/flights/${encodeURIComponent(ident)}`);
  const range = flightDateRange(date);
  if (range) {
    requestUrl.searchParams.set("start", range.start);
    requestUrl.searchParams.set("end", range.end);
  }

  const response = await fetchImpl(requestUrl, {
    headers: {
      "x-apikey": env.FLIGHTAWARE_AEROAPI_KEY,
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw httpError(response.status, `FlightAware request failed for ${ident}`);
  }

  const payload = await response.json();
  const flights = Array.isArray(payload.flights) ? payload.flights : [];
  if (!flights.length) {
    throw httpError(404, `No live flight records found for ${ident}.`);
  }

  const legs = flights.slice(0, 3).map((flight, index) => normalizeFlightAwareLeg(flight, index, date));
  const fetchedAt = new Date().toISOString();
  return {
    itineraryId: `${ident}-${date || "live"}`,
    source: "FlightAware AeroAPI",
    providerMode: "live",
    fetchedAt,
    legs: legs.map((leg) => ({ ...leg, fetchedAt, source: "FlightAware AeroAPI" }))
  };
}

function normalizeFlightAwareLeg(flight, index, requestedDate) {
  const ident = flight.ident_iata || flight.ident || "";
  const match = ident.match(/^([A-Z]{2,3})(\d+[A-Z]?)$/i);
  const origin = flight.origin || {};
  const destination = flight.destination || {};
  return {
    id: flight.fa_flight_id || `${ident}-${index}`,
    airline: match?.[1]?.toUpperCase() || ident.replace(/\d.*$/, "").toUpperCase(),
    flightNumber: match?.[2] || ident.replace(/^[A-Z]+/i, ""),
    date: requestedDate || isoDate(flight.scheduled_out || flight.scheduled_off || flight.scheduled_in),
    origin: origin.code_iata || origin.code || origin.airport_code || "",
    destination: destination.code_iata || destination.code || destination.airport_code || "",
    terminal: flight.terminal_origin || flight.terminal_destination || "",
    gate: flight.gate_origin || flight.gate_destination || "",
    status: flight.status || "live status available",
    scheduledDeparture: flight.scheduled_out || flight.scheduled_off || "",
    estimatedDeparture: flight.estimated_out || flight.estimated_off || flight.scheduled_out || "",
    scheduledArrival: flight.scheduled_in || flight.scheduled_on || "",
    estimatedArrival: flight.estimated_in || flight.estimated_on || flight.scheduled_in || ""
  };
}

function flightDateRange(date) {
  if (!date) return null;
  const startDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) return null;
  const endDate = new Date(startDate.getTime() + 36 * 60 * 60 * 1000);
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

function isoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function validateAirportMap(map, options = {}) {
  const errors = [];
  const warnings = [];
  for (const key of ["airportCode", "version", "nodes", "edges", "places"]) {
    if (!map?.[key]) errors.push(`Map bundle is missing required field: ${key}`);
  }
  if (!Array.isArray(map?.nodes) || !Array.isArray(map?.edges) || !Array.isArray(map?.places)) {
    errors.push("Map bundle nodes, edges, and places must be arrays.");
  }

  if (!errors.length) {
    const nodeIds = new Set(map.nodes.map((node) => node.id));
    const gateCount = map.places.filter((place) => place.kind === "gate").length;
    const brokenEdges = map.edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
    const missingScale = !map.scale?.unit || !map.scale?.pixelsPerMeter;

    if (!gateCount) errors.push("Map bundle must include at least one gate place.");
    if (brokenEdges.length) errors.push(`Map bundle has ${brokenEdges.length} edge(s) referencing missing nodes.`);
    if (missingScale) errors.push("Map bundle must include scale.unit and scale.pixelsPerMeter.");

    if (options.production) {
      if (!map.source && !map.provenance?.source) warnings.push("Production map should include source provenance.");
      if (!map.floors?.length) warnings.push("Production map should include floor metadata.");
      if (!map.places.some((place) => place.kind === "security")) warnings.push("Production map should include security checkpoints when applicable.");
    }
  }

  if (errors.length) {
    throw httpError(422, errors.join(" "), { diagnostics: { valid: false, errors, warnings } });
  }

  return {
    valid: true,
    production: Boolean(options.production),
    errors,
    warnings,
    counts: {
      floors: map.floors?.length || 0,
      nodes: map.nodes.length,
      edges: map.edges.length,
      gates: map.places.filter((place) => place.kind === "gate").length,
      amenities: map.places.filter((place) => place.kind === "amenity").length
    }
  };
}

function httpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}
