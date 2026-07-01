# Product Requirements

## Mission

Guide a traveler through any supported airport to the correct gate with live flight awareness, accessible turn-by-turn indoor navigation, and Wi-Fi connection assistance.

## Users

- leisure traveler with one boarding pass and low airport familiarity;
- frequent flyer with tight layovers;
- mobility-assisted traveler needing elevators and accessible paths;
- airport operations team validating maps, gates, closures, and walking-time estimates;
- enterprise airline or airport administrator managing integrations and support.

## Core Capabilities

1. Flight capture
   - Accept airline code, flight number, travel date, and optional reservation metadata.
   - Resolve itinerary legs, terminals, gates, scheduled/estimated times, baggage claim, and gate changes.
   - Alert users when a gate, terminal, boarding time, or delay changes.

2. Airport map and routing
   - Use scaled indoor maps with floors, walkable graph nodes, gates, amenities, vertical transport, security, border control, and temporary closures.
   - Support shortest, accessible, low-stairs, and layover-safe routing modes.
   - Preserve map version and source provenance for every route.

3. Live positioning
   - Use GPS/LTE when accuracy is useful outdoors or near terminal edges.
   - Use Wi-Fi RTT/fingerprints, BLE beacons, inertial motion, and map matching indoors.
   - Display confidence and fall back to manual "I am here" waypoints.

4. Wi-Fi assistance
   - Show airport-approved SSIDs, instructions, captive portal status, and privacy/security warnings.
   - Use native iOS/Android bridges for auto-join where platform policy allows.
   - Never store Wi-Fi passwords without OS-protected secure storage.

5. Layovers and re-routing
   - Detect inbound arrival gate, outbound departure gate, terminal transfer, security re-entry, immigration, and minimum connection time risk.
   - Recompute walking time when live position, gate, closure, or flight status changes.

6. Enterprise operations
   - Provide admin map validation, provider health, data freshness, incident rollback, and audit logs.
   - Offer privacy controls, consent, data minimization, and retention policies by tenant.

## Non-Negotiable Accuracy Constraints

- Airport maps must come from airport-owned data, contracted map providers, or validated standards such as IndoorGML/IMDF.
- Flight and gate updates must come from airline, airport, GDS, AODB, or commercial aviation feeds with SLAs.
- A route must expose confidence, data age, and map version.
- A route must refuse "high confidence" labeling when positioning error exceeds the corridor width or floor is uncertain.

## MVP Scope In This Repository

- PWA shell with trip entry, flight tracking mock, terminal map, route rendering, Wi-Fi assistant, and alert stream.
- Demo airport map with scaled coordinates, floors, amenities, gates, closures, and accessible edges.
- Domain modules and tests for routing, gate changes, layovers, positioning confidence, and Wi-Fi capability detection.

## Out Of Scope For Local Demo

- Real worldwide airport map corpus.
- Production live flight credentials.
- Native mobile OS Wi-Fi join implementation.
- Physical indoor calibration survey data.
