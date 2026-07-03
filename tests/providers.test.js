import test from "node:test";
import assert from "node:assert/strict";
import {
  providerStatus,
  resolveAirportMapCatalog,
  resolveAirportMapFromProviders,
  resolveFlightFromProviders
} from "../server/providers.js";
import { demoAirportMap } from "../public/app-assets/sample-data.js";

test("providerStatus reflects configured keys without exposing secrets", () => {
  const status = providerStatus({
    FLIGHTAWARE_AEROAPI_KEY: "secret",
    AIRPORT_MAP_BUNDLE_BASE_URL: "https://maps.example.com"
  });

  assert.deepEqual(status, {
    flight: "flightaware-aeroapi",
    airportMap: "production-map-bundles",
    productionMapsRequired: false,
    liveFlightsRequired: false,
    wifi: "client-native-bridge-or-manual"
  });
});

test("providerStatus reports production map catalog and required mode", () => {
  const status = providerStatus({
    AIRPORT_MAP_CATALOG_URL: "https://maps.example.com/index.json",
    GATE_GUIDE_MAP_MODE: "production"
  });

  assert.equal(status.airportMap, "production-map-catalog");
  assert.equal(status.productionMapsRequired, true);
});

test("flight provider falls back to demo when OpenSky is unreachable", async () => {
  const itinerary = await resolveFlightFromProviders(
    { airline: "AA", flightNumber: "1442", date: "2026-07-01" },
    { env: {}, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }
  );

  assert.equal(itinerary.providerMode, "demo");
  assert.equal(itinerary.legs[0].gate, "A18");
  assert.match(itinerary.warnings[0], /OpenSky/);
});

test("OpenSky adapter resolves live aircraft by callsign", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const itinerary = await resolveFlightFromProviders(
    { airline: "KL", flightNumber: "605", date: "2026-07-02" },
    {
      env: {},
      fetchImpl: async (url) => {
        if (String(url).includes("/states/all")) {
          return {
            ok: true,
            json: async () => ({
              states: [
                ["48044e", "KLM605  ", "Netherlands", nowSeconds, nowSeconds, 4.76, 52.31, 10058, false, 245]
              ]
            })
          };
        }
        if (String(url).includes("/flights/aircraft")) {
          return {
            ok: true,
            json: async () => ([
              { icao24: "48044e", firstSeen: nowSeconds - 7200, lastSeen: nowSeconds, estDepartureAirport: "EHAM", estArrivalAirport: "KSFO" }
            ])
          };
        }
        throw new Error(`unexpected url ${url}`);
      }
    }
  );

  assert.equal(itinerary.providerMode, "live");
  assert.equal(itinerary.source, "OpenSky Network");
  assert.equal(itinerary.legs[0].origin, "AMS");
  assert.equal(itinerary.legs[0].destination, "SFO");
  assert.equal(itinerary.legs[0].gate, "");
  assert.match(itinerary.legs[0].status, /en route/);
  assert.ok(itinerary.legs[0].position.lat);
});

test("OpenSky adapter reports untracked flights as 404", async () => {
  await assert.rejects(
    () => resolveFlightFromProviders(
      { airline: "AA", flightNumber: "9999", date: "2026-07-02" },
      {
        env: {},
        fetchImpl: async () => ({ ok: true, json: async () => ({ states: [] }) })
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 404);
      assert.match(error.message, /not currently being tracked/);
      return true;
    }
  );
});

test("FlightAware adapter normalizes live provider response", async () => {
  let requestedUrl = "";
  const itinerary = await resolveFlightFromProviders(
    { airline: "AA", flightNumber: "1442", date: "2026-07-01" },
    {
      env: { FLIGHTAWARE_AEROAPI_KEY: "test-key" },
      fetchImpl: async (url, options) => {
        requestedUrl = String(url);
        assert.equal(options.headers["x-apikey"], "test-key");
        return {
          ok: true,
          json: async () => ({
            flights: [
              {
                fa_flight_id: "AA1442-20260701",
                ident_iata: "AA1442",
                origin: { code_iata: "DFW" },
                destination: { code_iata: "LAX" },
                terminal_origin: "A",
                gate_origin: "A18",
                status: "Scheduled",
                scheduled_out: "2026-07-01T15:25:00-05:00",
                estimated_out: "2026-07-01T15:40:00-05:00"
              }
            ]
          })
        };
      }
    }
  );

  assert.match(requestedUrl, /\/flights\/AA1442/);
  assert.equal(itinerary.providerMode, "live");
  assert.equal(itinerary.source, "FlightAware AeroAPI");
  assert.equal(itinerary.legs[0].origin, "DFW");
  assert.equal(itinerary.legs[0].gate, "A18");
});

test("airport map provider loads configured remote bundle", async () => {
  const result = await resolveAirportMapFromProviders("dfw", {
    env: {
      AIRPORT_MAP_BUNDLE_BASE_URL: "https://maps.example.com/bundles",
      AIRPORT_MAP_BUNDLE_TOKEN: "map-token"
    },
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.authorization, "Bearer map-token");
      if (String(url).endsWith("/index.json")) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      assert.equal(String(url), "https://maps.example.com/bundles/DFW.json");
      return {
        ok: true,
        json: async () => demoAirportMap
      };
    }
  });

  assert.equal(result.providerMode, "production");
  assert.equal(result.map.airportCode, "DFW");
  assert.equal(result.diagnostics.valid, true);
  assert.equal(result.diagnostics.counts.gates, 3);
});

test("airport map catalog resolves explicit production entries", async () => {
  const catalog = await resolveAirportMapCatalog({
    env: { AIRPORT_MAP_CATALOG_URL: "https://maps.example.com/catalog.json" },
    fetchImpl: async (url) => {
      assert.equal(String(url), "https://maps.example.com/catalog.json");
      return {
        ok: true,
        json: async () => ({
          source: "airport-gis",
          entries: [
            { airportCode: "DFW", bundleUrl: "https://maps.example.com/DFW.json", version: "2026.07" }
          ]
        })
      };
    }
  });

  assert.equal(catalog.source, "airport-gis");
  assert.equal(catalog.entries[0].airportCode, "DFW");
});

test("production map mode refuses demo fallback", async () => {
  await assert.rejects(
    () => resolveAirportMapFromProviders("DFW", {
      env: { GATE_GUIDE_MAP_MODE: "production" },
      bundleDir: "no-such-dir/"
    }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.productionRequired, true);
      return true;
    }
  );
});

test("production map validation rejects unroutable bundles", async () => {
  await assert.rejects(
    () => resolveAirportMapFromProviders("DFW", {
      env: { AIRPORT_MAP_BUNDLE_BASE_URL: "https://maps.example.com" },
      fetchImpl: async (url) => String(url).endsWith("/index.json")
        ? { ok: false, status: 404, json: async () => ({}) }
        : {
            ok: true,
            json: async () => ({ airportCode: "DFW", version: "bad", nodes: [], edges: [], places: [] })
          }
    }),
    (error) => {
      assert.equal(error.statusCode, 422);
      assert.match(error.message, /at least one gate/);
      assert.equal(error.diagnostics.valid, false);
      return true;
    }
  );
});

test("bundled map bundles serve as production maps", async () => {
  const result = await resolveAirportMapFromProviders("TST", {
    env: { GATE_GUIDE_MAP_MODE: "production" },
    bundleDir: "tests/fixtures/maps/"
  });

  assert.equal(result.providerMode, "production");
  assert.equal(result.map.airportCode, "TST");
  assert.match(result.attribution, /OpenStreetMap/);
  assert.equal(result.diagnostics.valid, true);
});

test("bundled catalog lists bundles when no remote source is configured", async () => {
  const catalog = await resolveAirportMapCatalog({
    env: {},
    bundleDir: "tests/fixtures/maps/"
  });

  assert.equal(catalog.source, "openstreetmap-indoor");
  assert.equal(catalog.entries[0].airportCode, "TST");
  assert.match(catalog.attribution, /OpenStreetMap/);
});

test("strict flight mode refuses demo fallback when live lookup fails", async () => {
  await assert.rejects(
    () => resolveFlightFromProviders(
      { airline: "AA", flightNumber: "1442", date: "2026-07-02" },
      {
        env: { GATE_GUIDE_FLIGHT_MODE: "production" },
        fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) })
      }
    ),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /OpenSky/);
      return true;
    }
  );
});

test("providerStatus reports live ADS-B as the default flight provider", () => {
  const status = providerStatus({ GATE_GUIDE_FLIGHT_MODE: "production" });
  assert.equal(status.flight, "live-adsb");
  assert.equal(status.liveFlightsRequired, true);
});

test("community ADS-B adapter combines live state and route records", async () => {
  const itinerary = await resolveFlightFromProviders(
    { airline: "BA", flightNumber: "33", date: "2026-07-02" },
    {
      env: {},
      fetchImpl: async (url) => {
        if (String(url).includes("adsb.lol")) {
          return {
            ok: true,
            json: async () => ({ ac: [{ hex: "406f73", flight: "BAW33  ", alt_baro: 35000, gs: 512, lat: 51.1, lon: -30.2 }] })
          };
        }
        if (String(url).includes("adsbdb.com")) {
          return {
            ok: true,
            json: async () => ({
              response: {
                flightroute: {
                  callsign: "BAW33",
                  airline: { name: "British Airways", iata: "BA" },
                  origin: { iata_code: "LHR" },
                  destination: { iata_code: "DFW" }
                }
              }
            })
          };
        }
        throw new Error(`unexpected url ${url}`);
      }
    }
  );

  assert.equal(itinerary.providerMode, "live");
  assert.match(itinerary.source, /adsb\.lol/);
  assert.equal(itinerary.legs[0].origin, "LHR");
  assert.equal(itinerary.legs[0].destination, "DFW");
  assert.equal(itinerary.legs[0].airlineName, "British Airways");
  assert.equal(itinerary.legs[0].gate, "");
  assert.match(itinerary.legs[0].status, /en route/);
  assert.equal(itinerary.legs[0].position.lat, 51.1);
});
