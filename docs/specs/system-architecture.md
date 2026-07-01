# System Architecture

## Runtime Layers

1. Client PWA
   - Trip entry, map rendering, alerts, route instructions, offline cache, and accessibility UI.
   - Uses browser Geolocation API when available.
   - Calls native bridge methods when packaged in iOS/Android shells.

2. Mobile native shell
   - Provides Wi-Fi SSID discovery/join helpers, BLE scanning, Wi-Fi RTT, secure storage, background notifications, and deep links.
   - Bridges capabilities to the PWA through a narrow `NativeAirportBridge` contract.

3. Backend API
   - Normalizes flight, airport, gate, map, closure, and provider-health data.
   - Signs map bundles and exposes tenant-scoped configuration.
   - Pushes live operational updates through WebSocket/SSE/mobile push.

4. Data ingestion
   - Flight providers: airline direct, airport AODB, GDS, or commercial aviation data APIs.
   - Map providers: airport GIS/BIM export, IndoorGML/IMDF bundles, contracted venue maps, operations closures.
   - Positioning providers: Wi-Fi fingerprints, BLE beacons, survey calibration, live device telemetry with consent.

## Client Domain Modules

- `flightProvider`: resolves itinerary legs and emits gate/status changes.
- `airportMap`: stores floors, nodes, edges, gates, amenities, and closures.
- `router`: computes weighted routes and turn-by-turn instructions.
- `positioning`: merges GPS/manual/native readings into map-matched positions.
- `wifiAssistant`: recommends airport SSID flow and invokes native bridge when present.
- `alertCenter`: prioritizes operational changes and connection-risk messages.

## Provider API Endpoints

- `GET /api/providers` reports whether flight and map providers are live or demo-backed.
- `GET /api/flight` proxies live flight data through server-held provider credentials.
- `GET /api/airport-map` loads airport-approved map bundles by IATA code from a configured secure bundle host.

## Reliability Requirements

- All provider responses carry source, fetched-at time, and freshness budget.
- Map bundles are immutable by version and can be rolled back.
- Routing continues offline using the last valid signed map and itinerary.
- Gate changes trigger idempotent route recomputation.
- Positioning confidence is explicit and never hidden behind "blue dot" certainty.

## Security And Privacy

- Use explicit consent for location, Bluetooth, Wi-Fi, and trip import.
- Store only the minimum trip and location history required for navigation.
- Encrypt persisted trip data on device and in transit.
- Keep provider credentials on the backend only.
- Redact PII from logs and analytics.

## Standards And Provider Fit

- Indoor map model aligns with OGC IndoorGML concepts: cells, connectivity, floors, and navigable transitions.
- Browser location uses W3C Geolocation semantics.
- Wi-Fi joining is a native feature: web apps can explain and deep-link, while native shells perform platform-approved configuration.
