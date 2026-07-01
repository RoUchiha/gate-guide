# Data Contracts

## FlightLeg

```json
{
  "id": "leg-001",
  "airline": "AA",
  "flightNumber": "1442",
  "date": "2026-07-01",
  "origin": "DFW",
  "destination": "LAX",
  "terminal": "A",
  "gate": "A18",
  "status": "boarding",
  "scheduledDeparture": "2026-07-01T15:25:00-05:00",
  "estimatedDeparture": "2026-07-01T15:40:00-05:00",
  "source": "provider-name",
  "fetchedAt": "2026-06-30T18:00:00Z"
}
```

## AirportMap

```json
{
  "airportCode": "DFW",
  "version": "2026.07.0",
  "scale": { "unit": "meter", "pixelsPerMeter": 3 },
  "floors": [{ "id": "F1", "label": "Departures" }],
  "nodes": [{ "id": "security-a", "floorId": "F1", "x": 80, "y": 180, "kind": "security" }],
  "edges": [{ "from": "security-a", "to": "gate-a18", "meters": 140, "accessible": true }],
  "places": [{ "id": "gate-a18", "kind": "gate", "label": "A18", "nodeId": "gate-a18" }]
}
```

## AirportMapCatalog

```json
{
  "source": "airport-gis-or-map-provider",
  "version": "2026.07",
  "entries": [
    {
      "airportCode": "DFW",
      "bundleUrl": "https://maps.example.com/DFW.json",
      "format": "gate-guide-airport-map",
      "version": "2026.07",
      "updatedAt": "2026-07-01T00:00:00Z",
      "source": "airport-owned-imdf-export",
      "checksum": "sha256-..."
    }
  ]
}
```

## PositionReading

```json
{
  "source": "gps|wifi-rtt|ble|manual|native-fusion",
  "lat": 32.897,
  "lon": -97.040,
  "floorId": "F1",
  "accuracyMeters": 12,
  "timestamp": "2026-06-30T18:00:00Z"
}
```

## WifiNetworkProfile

```json
{
  "ssid": "Airport-Free-WiFi",
  "airportCode": "DFW",
  "security": "open-captive-portal",
  "captivePortalUrl": "https://wifi.example.com",
  "trusted": true,
  "instructions": ["Select Airport-Free-WiFi", "Accept airport terms"]
}
```

## RouteResult

```json
{
  "routeId": "route-001",
  "mapVersion": "2026.07.0",
  "fromNodeId": "security-a",
  "toNodeId": "gate-a18",
  "meters": 140,
  "etaMinutes": 3,
  "confidence": "medium",
  "steps": ["Continue 90 m through Concourse A", "Gate A18 is on your right"]
}
```
