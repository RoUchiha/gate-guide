# Gate Guide

Spec-driven airport wayfinding PWA for guiding travelers from check-in, security, lounges, and layover arrivals to the correct gate.

This repository is intentionally built around production constraints:

- accurate scaled indoor maps require licensed airport/venue map feeds or airport-owned IndoorGML/IMDF data;
- live gate data requires airline, airport, GDS, or commercial aviation data provider contracts;
- browser apps can read GPS with permission, but Wi-Fi SSID scanning and auto-join need native iOS/Android bridges;
- indoor navigation needs sensor fusion: GPS, Wi-Fi RTT/fingerprints, BLE beacons, inertial dead reckoning, and map matching.

The runnable app ships with a calibrated demo airport and mock provider adapters so the product, architecture, routing, and test contracts are visible end to end.

## Run

```powershell
npm.cmd test
npm.cmd start
```

Then open `http://127.0.0.1:4173`.

## Specs

- [Product Requirements](docs/specs/product-requirements.md)
- [System Architecture](docs/specs/system-architecture.md)
- [Data Contracts](docs/specs/data-contracts.md)
- [Acceptance Tests](docs/specs/acceptance-tests.md)
- [Provider Integrations](docs/specs/provider-integrations.md)

## Live Provider Setup

Gate Guide now has server-side provider endpoints:

- `/api/providers`
- `/api/flight`
- `/api/airport-map`

Set `FLIGHTAWARE_AEROAPI_KEY` for live flight/gate data, `AIRPORT_MAP_CATALOG_URL` or `AIRPORT_MAP_BUNDLE_BASE_URL` for airport-approved map bundles, and `GATE_GUIDE_MAP_MODE=production` when demo fallback must be disabled. See [Provider Integrations](docs/specs/provider-integrations.md).

## Production Integration Checklist

- Replace `MockFlightProvider` with contracted live flight feeds.
- Replace the demo `AirportMap` with airport-validated IndoorGML/IMDF or provider map imports.
- Connect native iOS/Android Wi-Fi join helpers to `WifiBridge`.
- Run calibration surveys per terminal and publish per-floor positioning confidence models.
- Add SSO, audit logs, observability, privacy retention rules, and on-call runbooks before enterprise rollout.
