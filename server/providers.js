import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { demoAirportMap } from "../public/app-assets/sample-data.js";
import { MockFlightProvider } from "../public/app-assets/flight-provider.js";

const flightAwareBaseUrl = "https://aeroapi.flightaware.com/aeroapi";
const openSkyBaseUrl = "https://opensky-network.org/api";
const openSkyTokenUrl = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const bundledMapsDir = fileURLToPath(new URL("../public/maps/", import.meta.url));

// IATA airline designator -> ICAO callsign prefix used in ADS-B transponders.
const airlineIcaoPrefixes = {
  AA: "AAL", DL: "DAL", UA: "UAL", WN: "SWA", AS: "ASA", B6: "JBU", NK: "NKS",
  F9: "FFT", AC: "ACA", WS: "WJA", BA: "BAW", LH: "DLH", AF: "AFR", KL: "KLM",
  LX: "SWR", OS: "AUA", SN: "BEL", AY: "FIN", SK: "SAS", IB: "IBE", VY: "VLG",
  EK: "UAE", QR: "QTR", EY: "ETD", TK: "THY", SQ: "SIA", CX: "CPA", QF: "QFA",
  NH: "ANA", JL: "JAL", KE: "KAL", OZ: "AAR", U2: "EZY", FR: "RYR", EW: "EWG"
};

// ICAO airport codes (as reported by OpenSky) -> IATA codes the app uses.
const airportIcaoToIata = {
  EHAM: "AMS", LFPG: "CDG", EDDF: "FRA", EFHK: "HEL", EGLL: "LHR", EDDM: "MUC",
  LSZH: "ZRH", KDFW: "DFW", KATL: "ATL", KORD: "ORD", KDEN: "DEN", KSFO: "SFO",
  KSEA: "SEA", KLAX: "LAX", KJFK: "JFK", KMIA: "MIA", KBOS: "BOS", KPHX: "PHX",
  KIAH: "IAH", KEWR: "EWR", KCLT: "CLT", KMSP: "MSP", KLAS: "LAS", KPHL: "PHL",
  KDTW: "DTW", KSLC: "SLC", KIAD: "IAD", KMCO: "MCO", KSAN: "SAN", KAUS: "AUS",
  EGKK: "LGW", EDDL: "DUS", EDDB: "BER", EDDH: "HAM", LFPO: "ORY", LEMD: "MAD",
  LEBL: "BCN", LIRF: "FCO", LIMC: "MXP", LOWW: "VIE", LSGG: "GVA", EKCH: "CPH",
  ENGM: "OSL", ESSA: "ARN", EIDW: "DUB", LPPT: "LIS", LGAV: "ATH", LTFM: "IST",
  OMDB: "DXB", OTHH: "DOH", VHHH: "HKG", WSSS: "SIN", RJTT: "HND", RJAA: "NRT",
  RKSI: "ICN", YSSY: "SYD", CYYZ: "YYZ", CYVR: "YVR", CYUL: "YUL"
};

export function providerStatus(env = process.env) {
  const productionMapsRequired = requiresProductionMaps(env);
  return {
    flight: env.FLIGHTAWARE_AEROAPI_KEY ? "flightaware-aeroapi" : "opensky-network",
    airportMap: mapProviderName(env),
    productionMapsRequired,
    liveFlightsRequired: requiresLiveFlights(env),
    wifi: "client-native-bridge-or-manual"
  };
}

export async function resolveFlightFromProviders(query, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;

  if (env.FLIGHTAWARE_AEROAPI_KEY) {
    return resolveFlightAware(query, { env, fetchImpl });
  }

  try {
    return await resolveOpenSky(query, { env, fetchImpl });
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404 || requiresLiveFlights(env)) {
      throw error;
    }
    const provider = new MockFlightProvider();
    const itinerary = await provider.resolveFlight(query);
    return {
      ...itinerary,
      providerMode: "demo",
      warnings: [`Live OpenSky lookup failed (${error.message}). Showing demo data.`]
    };
  }
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

  const bundled = await loadBundledMap(normalizedAirport, options);
  if (bundled) {
    const { map, provenance } = normalizeMapPayload(bundled.payload, bundled.entry);
    const diagnostics = validateAirportMap(map, { production: true });
    return {
      providerMode: "production",
      source: bundled.payload.source || "bundled-map",
      attribution: bundled.payload.attribution || map.attribution || null,
      fetchedAt: new Date().toISOString(),
      provenance,
      diagnostics,
      map
    };
  }

  if (productionMapsRequired) {
    throw httpError(503, `No production map is available for ${normalizedAirport}.`, {
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

  const bundledCatalog = await loadBundledCatalog(options);
  if (bundledCatalog) return bundledCatalog;

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

async function loadBundledMap(airportCode, options = {}) {
  const dir = options.bundleDir || bundledMapsDir;
  if (!/^[A-Z0-9]{3,4}$/.test(airportCode)) return null;
  try {
    const raw = await readFile(`${dir}${airportCode}.json`, "utf8");
    const payload = JSON.parse(raw);
    return {
      payload,
      entry: {
        bundleUrl: `/maps/${airportCode}.json`,
        format: payload.format || "gate-guide-airport-map",
        source: payload.source || "bundled-map",
        version: payload.version || null,
        updatedAt: payload.updatedAt || null
      }
    };
  } catch {
    return null;
  }
}

async function loadBundledCatalog(options = {}) {
  const dir = options.bundleDir || bundledMapsDir;
  try {
    const raw = await readFile(`${dir}index.json`, "utf8");
    const catalog = JSON.parse(raw);
    const normalized = normalizeCatalog(catalog, "/maps/index.json");
    if (!normalized.entries.length) return null;
    normalized.attribution = catalog.attribution || null;
    return normalized;
  } catch {
    return null;
  }
}

export function hasBundledMaps(options = {}) {
  return existsSync(`${options.bundleDir || bundledMapsDir}index.json`);
}

function mapProviderName(env) {
  if (env.AIRPORT_MAP_CATALOG_URL) return "production-map-catalog";
  if (env.AIRPORT_MAP_BUNDLE_BASE_URL) return "production-map-bundles";
  if (hasBundledMaps()) return "bundled-osm-maps";
  if (requiresProductionMaps(env)) return "missing-production-map-provider";
  return "demo";
}

function requiresProductionMaps(env) {
  return env.GATE_GUIDE_MAP_MODE === "production" || env.REQUIRE_PRODUCTION_MAPS === "true";
}

function requiresLiveFlights(env) {
  return env.GATE_GUIDE_FLIGHT_MODE === "production" || env.REQUIRE_LIVE_FLIGHTS === "true";
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

let openSkyToken = null;

async function openSkyHeaders(env, fetchImpl) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return {};
  if (openSkyToken && openSkyToken.expiresAt > Date.now() + 30000) {
    return { authorization: `Bearer ${openSkyToken.value}` };
  }
  const response = await fetchImpl(openSkyTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET
    })
  });
  if (!response.ok) return {};
  const payload = await response.json();
  openSkyToken = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in || 1800) * 1000 };
  return { authorization: `Bearer ${openSkyToken.value}` };
}

// OpenSky Network: real live ADS-B data, no key required. It tracks aircraft,
// not airports — live position and status are real, but gate and terminal
// assignments do not exist in this data source and are reported as unknown.
async function resolveOpenSky({ airline, flightNumber, date }, { env, fetchImpl }) {
  const iata = String(airline || "").trim().toUpperCase();
  const number = String(flightNumber || "").trim();
  if (!iata || !number) throw httpError(400, "Airline and flight number are required.");

  const callsign = `${airlineIcaoPrefixes[iata] || iata}${number}`;
  const headers = await openSkyHeaders(env, fetchImpl);

  const statesResponse = await fetchImpl(`${openSkyBaseUrl}/states/all`, { headers });
  if (!statesResponse.ok) {
    throw httpError(statesResponse.status === 429 ? 429 : 502, `OpenSky states request failed (HTTP ${statesResponse.status}).`);
  }
  const statesPayload = await statesResponse.json();
  const state = (statesPayload.states || []).find(
    (candidate) => String(candidate[1] || "").trim().toUpperCase() === callsign
  );

  if (!state) {
    throw httpError(404, `${iata} ${number} (callsign ${callsign}) is not currently being tracked by OpenSky. ADS-B only covers airborne or recently active aircraft.`);
  }

  const [icao24, , , , lastContact, lon, lat, baroAltitude, onGround, velocity] = state;

  // Enrich with the aircraft's current flight record (origin/destination)
  // when the endpoint is available for this access level.
  let flightRecord = null;
  try {
    const end = Math.floor(Date.now() / 1000);
    const begin = end - 2 * 24 * 3600;
    const flightsResponse = await fetchImpl(
      `${openSkyBaseUrl}/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`,
      { headers }
    );
    if (flightsResponse.ok) {
      const flights = await flightsResponse.json();
      if (Array.isArray(flights) && flights.length) {
        flightRecord = flights.sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0))[0];
      }
    }
  } catch {
    // Position data alone is still a valid live result.
  }

  const fetchedAt = new Date().toISOString();
  const origin = mapIcaoAirport(flightRecord?.estDepartureAirport);
  const destination = mapIcaoAirport(flightRecord?.estArrivalAirport);
  const status = onGround
    ? "on ground (live ADS-B)"
    : `en route (live ADS-B${baroAltitude ? `, ${Math.round(baroAltitude)} m` : ""}${velocity ? `, ${Math.round(velocity * 3.6)} km/h` : ""})`;

  const leg = {
    id: `${callsign}-${icao24}`,
    airline: iata,
    flightNumber: number,
    date: date || fetchedAt.slice(0, 10),
    origin,
    destination,
    terminal: "",
    gate: "",
    status,
    scheduledDeparture: flightRecord?.firstSeen ? new Date(flightRecord.firstSeen * 1000).toISOString() : "",
    estimatedDeparture: flightRecord?.firstSeen ? new Date(flightRecord.firstSeen * 1000).toISOString() : "",
    scheduledArrival: flightRecord?.lastSeen ? new Date(flightRecord.lastSeen * 1000).toISOString() : "",
    estimatedArrival: flightRecord?.lastSeen ? new Date(flightRecord.lastSeen * 1000).toISOString() : "",
    position: lat !== null && lon !== null
      ? { lat, lon, lastContact: lastContact ? new Date(lastContact * 1000).toISOString() : null }
      : null,
    fetchedAt,
    source: "OpenSky Network"
  };

  return {
    itineraryId: `${callsign}-${date || "live"}`,
    source: "OpenSky Network",
    providerMode: "live",
    fetchedAt,
    warnings: ["OpenSky provides live positions but no gate assignments; gate data needs an airline/airport feed such as FlightAware AeroAPI."],
    legs: [leg]
  };
}

function mapIcaoAirport(icaoCode) {
  if (!icaoCode) return "";
  return airportIcaoToIata[icaoCode] || icaoCode;
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
