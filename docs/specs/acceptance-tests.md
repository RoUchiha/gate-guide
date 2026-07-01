# Acceptance Tests

## Flight And Gate Changes

- Given a traveler enters a supported flight, when the provider returns an active leg, then the app shows terminal, gate, boarding status, provider source, and fetched-at time.
- Given the provider emits a gate change, when the new gate differs from the current route destination, then the app adds an alert and recomputes the route.
- Given a layover itinerary has less than the minimum connection buffer, then the app marks the connection as at risk and prioritizes the fastest valid route.

## Routing

- Given a map with weighted edges, when a destination gate is selected, then the shortest route returns expected nodes, distance, ETA, and instructions.
- Given accessible mode is enabled, when an inaccessible edge is shorter, then the router avoids it.
- Given an edge closure exists, then routing excludes that edge and reports no route if all paths are closed.

## Positioning

- Given GPS accuracy is worse than the corridor confidence threshold, then the route confidence is low.
- Given a manual starting point is selected, then the app routes from that map node without requesting device location.
- Given a native bridge supplies a floor-aware fix, then map matching prefers the same-floor nearest node.

## Wi-Fi Assist

- Given no native Wi-Fi bridge is present, then the app gives connection instructions and captive portal guidance.
- Given a native bridge is present and the airport profile is trusted, then the app invokes the bridge and records success/failure status.
- Given a network profile is untrusted, then the app refuses auto-join.

## Offline And Recovery

- Given the app is offline with a cached map and itinerary, then it continues routing and clearly labels data freshness.
- Given map version rollback occurs, then route results expose the rollback version and source.
