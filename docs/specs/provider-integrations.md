# Provider Integrations

Gate Guide supports real providers through server-side environment variables. The browser never receives API keys.

## Live Flight Data

### FlightAware AeroAPI

Set this Vercel environment variable:

```text
FLIGHTAWARE_AEROAPI_KEY=your-flightaware-key
```

Gate Guide calls:

```text
GET https://aeroapi.flightaware.com/aeroapi/flights/{AIRLINE}{FLIGHT_NUMBER}
```

The server normalizes FlightAware fields such as IATA ident, origin, destination, terminal, gate, scheduled times, estimated times, and status into `FlightLeg`.

If the key is absent or the provider request fails, `/api/flight` returns the demo itinerary with a warning so the UI remains troubleshootable.

## Airport Map Bundles

Worldwide accurate airport interiors require airport-owned data, IMDF/IndoorGML exports, or a licensed indoor-map provider. Gate Guide expects those data sources to be normalized into the `AirportMap` schema in [Data Contracts](data-contracts.md).

Set these Vercel environment variables:

```text
GATE_GUIDE_MAP_MODE=production
AIRPORT_MAP_CATALOG_URL=https://your-secure-map-host.example.com/catalog.json
AIRPORT_MAP_BUNDLE_BASE_URL=https://your-secure-map-host.example.com/maps
AIRPORT_MAP_BUNDLE_TOKEN=optional-bearer-token
```

For production worldwide coverage, prefer a catalog:

```text
GET {AIRPORT_MAP_CATALOG_URL}
Authorization: Bearer {AIRPORT_MAP_BUNDLE_TOKEN}
```

Catalog shape:

```json
{
  "source": "airport-gis-or-map-provider",
  "version": "2026.07",
  "entries": [
    {
      "airportCode": "DFW",
      "bundleUrl": "https://your-secure-map-host.example.com/maps/DFW.json",
      "format": "gate-guide-airport-map",
      "version": "2026.07",
      "updatedAt": "2026-07-01T00:00:00Z",
      "source": "airport-owned-imdf-export",
      "checksum": "sha256-..."
    }
  ]
}
```

If you only have direct bundles, Gate Guide calls:

```text
GET {AIRPORT_MAP_BUNDLE_BASE_URL}/{IATA_CODE}.json
Authorization: Bearer {AIRPORT_MAP_BUNDLE_TOKEN}
```

The hosted JSON must contain:

- `airportCode`
- `version`
- `scale`
- `floors`
- `nodes`
- `edges`
- `places`
- optional `closures`

This lets you source maps from airport GIS/BIM exports, Apple IMDF, OGC IndoorGML pipelines, Mappedin, MapsIndoors, or another commercial venue-map provider while keeping Gate Guide's routing engine provider-neutral.

When `GATE_GUIDE_MAP_MODE=production` is set, Gate Guide refuses demo fallback if a production bundle is missing or invalid.

## Map Diagnostics

```text
GET /api/airport-map/catalog
GET /api/airport-map?airport=DFW
```

`/api/airport-map` validates every production bundle before routing:

- required schema fields;
- scaled units;
- at least one gate;
- edges that only reference known nodes;
- floor and provenance warnings.

## Provider Status Endpoint

```text
GET /api/providers
```

Returns which provider path is currently active:

```json
{
  "flight": "flightaware-aeroapi",
  "airportMap": "remote-map-bundle",
  "wifi": "client-native-bridge-or-manual"
}
```

## Vercel Setup

```powershell
npx.cmd --yes vercel@latest env add FLIGHTAWARE_AEROAPI_KEY production
npx.cmd --yes vercel@latest env add AIRPORT_MAP_BUNDLE_BASE_URL production
npx.cmd --yes vercel@latest env add AIRPORT_MAP_BUNDLE_TOKEN production
npx.cmd --yes vercel@latest deploy --prod --yes
```
