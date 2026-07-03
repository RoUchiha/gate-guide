# Gate Guide

Spec-driven airport wayfinding PWA for guiding travelers from check-in, security, lounges, and layover arrivals to the correct gate.

**Live app:** https://gate-guide-ashen.vercel.app

- **Live flight tracking with no API key**: community ADS-B data (api.adsb.lol live aircraft state + api.adsbdb.com route records), with OpenSky Network as fallback and FlightAware AeroAPI as the optional gate-capable upgrade. ADS-B sources honestly report gates as "not published" — gate assignments only exist in airline/airport feeds.
- **Real airport maps**: bundled indoor map data for AMS, CDG, FRA, HEL, LHR, MUC, and ZRH, generated from OpenStreetMap indoor mapping by `scripts/build-osm-maps.js` (Map data © OpenStreetMap contributors, ODbL). Airports whose OSM coverage cannot actually route gate-to-security are rejected by the pipeline, never faked.
- Weighted, closure-aware routing with an accessible-route mode that avoids stairs-only edges.
- Installable PWA: offline app shell, versioned service-worker caches, dark mode, real icons.
- Strict production modes: `GATE_GUIDE_MAP_MODE=production` refuses demo-map fallback; `GATE_GUIDE_FLIGHT_MODE=production` refuses demo flight data — the app shows honest "not configured" errors instead of fabricated results.

This repository is intentionally built around production constraints:

- accurate scaled indoor maps require licensed airport/venue map feeds or airport-owned IndoorGML/IMDF data;
- live gate data requires airline, airport, GDS, or commercial aviation data provider contracts;
- browser apps can read GPS with permission, but Wi-Fi SSID scanning and auto-join need native iOS/Android bridges;
- indoor navigation needs sensor fusion: GPS, Wi-Fi RTT/fingerprints, BLE beacons, inertial dead reckoning, and map matching.

The runnable app ships with a calibrated demo airport (DFW Terminal A) and mock provider adapters so the product, architecture, routing, and test contracts are visible end to end.

## Run

```powershell
npm run verify   # spec check + tests + build
npm start        # http://127.0.0.1:4173
```

No dependencies to install — the app is plain ES modules on Node 20+.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm start` | Local server (serves the same handler Vercel runs) |
| `npm test` | Node test-runner suite (router, providers, server, positioning, Wi-Fi) |
| `npm run check` | Spec-file presence and content check |
| `npm run build` | Copies `public/` into `dist/` |
| `npm run icons` | Regenerates PWA icons from `scripts/generate-icons.js` |
| `npm run verify` | check + test + build |

## Architecture

- `index.js` — Vercel serverless entrypoint: serves the PWA from `public/` and the API (`/api/providers`, `/api/flight`, `/api/airport-map`, `/api/airport-map/catalog`) with security headers and a CSP.
- `server/providers.js` — FlightAware AeroAPI adapter, production map catalog/bundle loader, map validation.
- `public/app-assets/` — browser modules (UI state, Dijkstra routing, positioning confidence, Wi-Fi assist). They live here, not `public/src/`, because Vercel treats `public/src/*.js` as serverless entrypoints.
- `docs/specs/` — the specs the implementation is checked against.

## Specs

- [Product Requirements](docs/specs/product-requirements.md)
- [System Architecture](docs/specs/system-architecture.md)
- [Data Contracts](docs/specs/data-contracts.md)
- [Acceptance Tests](docs/specs/acceptance-tests.md)
- [Provider Integrations](docs/specs/provider-integrations.md)

## Live Provider Setup

All configuration is via environment variables (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `FLIGHTAWARE_AEROAPI_KEY` | Optional: gate-capable flight data from FlightAware AeroAPI (takes priority over ADS-B) |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | Optional: registered OpenSky credentials for the fallback provider |
| `GATE_GUIDE_FLIGHT_MODE` | Set to `production` to refuse demo flight fallback (503 instead of fake data) |
| `GATE_GUIDE_MAP_MODE` | Set to `production` to refuse demo-map fallback (returns 503 instead) |
| `AIRPORT_MAP_CATALOG_URL` | Remote catalog JSON of airport-approved bundles (overrides bundled maps) |
| `AIRPORT_MAP_BUNDLE_BASE_URL` | Direct bundle host (`{base}/{IATA}.json`) — alternative to the catalog |
| `AIRPORT_MAP_BUNDLE_TOKEN` | Optional bearer token for the map host |

Bundled OSM maps in `public/maps/` are always available as a production map source; regenerate or extend them with `node scripts/build-osm-maps.js [IATA ...]`. Without any flight key the app runs flight lookups in demo mode (unless strict mode) and says so in the UI. See [Provider Integrations](docs/specs/provider-integrations.md) for contracts and payload shapes.

## Deploy

The Vercel project (`rouchihas-projects/gate-guide`) uses `index.js` as the root serverless entrypoint.

```powershell
npx vercel deploy --prod --yes
```

Verify after deploy:

```powershell
Invoke-RestMethod https://gate-guide-ashen.vercel.app/api/providers
Invoke-RestMethod "https://gate-guide-ashen.vercel.app/api/airport-map?airport=DFW"
```

## Production Integration Checklist

- Add a `FLIGHTAWARE_AEROAPI_KEY` in Vercel for live flight/gate data.
- Publish an airport-approved map catalog and set `AIRPORT_MAP_CATALOG_URL` + `GATE_GUIDE_MAP_MODE=production`.
- Connect native iOS/Android Wi-Fi join helpers to the `NativeAirportBridge` seam.
- Run calibration surveys per terminal and publish per-floor positioning confidence models.
- Add SSO, audit logs, observability, privacy retention rules, and on-call runbooks before enterprise rollout.
