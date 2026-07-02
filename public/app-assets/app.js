import { demoAirportMap, wifiProfileFor } from "./sample-data.js";
import { ApiFlightProvider, summarizeConnectionRisk } from "./flight-provider.js";
import { confidenceForReading, browserGpsReading, manualReading, projectOutdoorGpsToTerminal } from "./positioning.js";
import { connectToWifi, wifiCapability } from "./wifi-assistant.js";
import { getNode, isEdgeClosed, nearestNode, placeToNode, routeBetween } from "./router.js";

const state = {
  map: demoAirportMap,
  provider: new ApiFlightProvider(),
  providerStatus: null,
  mapDiagnostics: null,
  mapError: null,
  productionMapBlocked: false,
  itinerary: null,
  fromNodeId: "security-a",
  destinationNodeId: "gate-a18",
  positionConfidence: "manual",
  accessible: false,
  alerts: ["Checking live provider configuration."]
};

const elements = {
  form: document.querySelector("#flight-form"),
  airline: document.querySelector("#airline"),
  flightNumber: document.querySelector("#flight-number"),
  flightDate: document.querySelector("#flight-date"),
  flightCard: document.querySelector("#flight-card"),
  wifiCard: document.querySelector("#wifi-card"),
  joinWifi: document.querySelector("#join-wifi"),
  alerts: document.querySelector("#alerts"),
  routeTitle: document.querySelector("#route-title"),
  routeMeta: document.querySelector("#route-meta"),
  routeSteps: document.querySelector("#route-steps"),
  map: document.querySelector("#map"),
  providerHealth: document.querySelector("#provider-health"),
  accessibleMode: document.querySelector("#accessible-mode"),
  trackButton: document.querySelector("#track-flight"),
  mapTitle: document.querySelector("#map-title"),
  airportSelect: document.querySelector("#airport-select"),
  mapAttribution: document.querySelector("#map-attribution"),
  locateSecurity: document.querySelector("#locate-security"),
  locateArrival: document.querySelector("#locate-arrival"),
  useGps: document.querySelector("#use-gps")
};

elements.flightDate.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

bootstrap();

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  addAlert("Resolving flight with configured provider.");
  setTracking(true);
  try {
    const itinerary = await state.provider.resolveFlight({
      airline: elements.airline.value.trim().toUpperCase(),
      flightNumber: elements.flightNumber.value.trim(),
      date: elements.flightDate.value
    }, { allowDemoFallback: state.providerStatus?.flight === "demo" });
    await applyItinerary(itinerary);
  } catch (error) {
    addAlert(`Could not resolve that flight: ${error.message}`);
  } finally {
    setTracking(false);
  }

  window.setTimeout(() => {
    if (!state.itinerary || state.itinerary.providerMode === "live") return;
    void applyItinerary(state.provider.simulateGateChange(state.itinerary, "A21"));
    addAlert("Demo gate changed to A21. Route recalculated.");
  }, 8000);
});

function setTracking(active) {
  if (!elements.trackButton) return;
  elements.trackButton.disabled = active;
  elements.trackButton.textContent = active ? "Tracking…" : "Track flight";
}

elements.accessibleMode.addEventListener("change", () => {
  state.accessible = elements.accessibleMode.checked;
  render();
});

elements.locateSecurity.addEventListener("click", () => setManualStartByKind("security"));
elements.locateArrival.addEventListener("click", () => setManualStartByKind("arrival"));

elements.airportSelect?.addEventListener("change", async () => {
  const airportCode = elements.airportSelect.value;
  if (!airportCode || airportCode === state.map?.airportCode) return;
  addAlert(`Loading ${airportCode} map...`);
  await loadAirportMap(airportCode);
  render();
});

elements.useGps.addEventListener("click", () => {
  if (!navigator.geolocation) {
    addAlert("GPS is not available in this browser. Choose a manual start point.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const reading = projectOutdoorGpsToTerminal(browserGpsReading(position), state.map);
      const node = nearestNode(state.map, reading);
      state.fromNodeId = node.id;
      state.positionConfidence = confidenceForReading(reading);
      addAlert(`GPS fix received with ${Math.round(reading.accuracyMeters)} m accuracy. Indoor confidence is ${state.positionConfidence}.`);
      render();
    },
    () => addAlert("Location permission was denied or unavailable. Manual start remains active."),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
  );
});

elements.joinWifi.addEventListener("click", async () => {
  const result = await connectToWifi(wifiProfileFor(state.map.airportCode));
  addAlert(result.message || (result.ok ? "Wi-Fi connection started." : "Wi-Fi connection needs manual setup."));
  renderWifi();
});

function setManualStartByKind(kind) {
  const node = state.map.nodes.find((candidate) => candidate.kind === kind);
  if (!node) {
    addAlert(`This ${state.map.airportCode} map has no mapped ${kind === "arrival" ? "entrance" : kind} point yet. Use GPS or stay on the default start.`);
    return;
  }
  const reading = manualReading(node);
  state.fromNodeId = node.id;
  state.positionConfidence = confidenceForReading(reading);
  addAlert(`Start set to ${node.label || node.id}.`);
  render();
}

async function bootstrap() {
  await Promise.all([loadProviderStatus(), loadAirportCatalog()]);
  await loadAirportMap(state.catalogCodes?.[0] || "DFW");
  render();
}

async function loadAirportCatalog() {
  if (!elements.airportSelect) return;
  try {
    const response = await fetch("/api/airport-map/catalog");
    const catalog = await response.json();
    const codes = (catalog.entries || []).map((entry) => entry.airportCode).sort();
    if (!codes.length) return;
    elements.airportSelect.innerHTML = codes
      .map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`)
      .join("");
    state.catalogCodes = codes;
  } catch {
    // The selector simply stays empty when the catalog is unavailable.
  }
}

async function loadProviderStatus() {
  try {
    const response = await fetch("/api/providers");
    state.providerStatus = await response.json();
    renderProviderStatus();
  } catch {
    state.providerStatus = { flight: "demo", airportMap: "demo", wifi: "manual" };
    renderProviderStatus();
  }
}

async function loadAirportMap(airportCode) {
  try {
    const response = await fetch(`/api/airport-map?airport=${encodeURIComponent(airportCode)}`);
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error || "Airport map request failed.");
      error.productionRequired = Boolean(payload.productionRequired);
      error.diagnostics = payload.diagnostics;
      throw error;
    }
    state.map = payload.map;
    state.mapDiagnostics = payload.diagnostics || null;
    state.mapError = null;
    state.productionMapBlocked = false;
    state.fromNodeId = defaultStartNode(state.map);
    if (elements.airportSelect && state.catalogCodes?.includes(state.map.airportCode)) {
      elements.airportSelect.value = state.map.airportCode;
    }
    addAlert(payload.providerMode === "live"
      ? `Loaded live ${state.map.airportCode} map bundle (${state.map.version}).`
      : payload.providerMode === "production"
        ? `Loaded production ${state.map.airportCode} map bundle (${state.map.version}).`
        : `Using demo ${state.map.airportCode} map bundle. ${payload.warnings?.[0] || ""}`.trim());
    for (const warning of payload.diagnostics?.warnings || []) addAlert(`Map warning: ${warning}`);
  } catch (error) {
    state.mapDiagnostics = error.diagnostics || null;
    state.mapError = error.message;
    state.productionMapBlocked = Boolean(error.productionRequired);
    if (state.productionMapBlocked) {
      addAlert(`Production map blocked: ${error.message}`);
    } else {
      state.map = demoAirportMap;
      addAlert(`Live map unavailable: ${error.message}. Using demo DFW map.`);
    }
  }
}

async function applyItinerary(itinerary) {
  const previousGate = state.itinerary?.legs?.[0]?.gate;
  state.itinerary = itinerary;
  const activeLeg = itinerary.legs[0];

  if (activeLeg.origin && activeLeg.origin !== state.map.airportCode) {
    await loadAirportMap(activeLeg.origin);
  }

  state.destinationNodeId = resolveDestinationNode(activeLeg.gate);
  const risk = summarizeConnectionRisk(itinerary);

  for (const warning of itinerary.warnings || []) addAlert(warning);
  if (previousGate && previousGate !== activeLeg.gate) {
    addAlert(`Gate changed from ${previousGate} to ${activeLeg.gate}.`);
  }
  if (risk) addAlert(risk.message);

  render();
}

function resolveDestinationNode(gate) {
  if (gate) {
    try {
      return placeToNode(state.map, gate.toLowerCase());
    } catch {
      addAlert(`Gate ${gate} is not present in the loaded ${state.map.airportCode} map. Routing to the closest known gate.`);
    }
  } else {
    addAlert("Live provider did not return a gate yet. Routing to the first known departure gate.");
  }

  return state.map.places.find((place) => place.kind === "gate")?.nodeId || state.map.nodes[0].id;
}

function defaultStartNode(map) {
  return map.nodes.find((node) => node.kind === "security")?.id
    || map.nodes.find((node) => node.kind === "arrival")?.id
    || map.nodes[0].id;
}

function addAlert(message) {
  state.alerts = [message, ...state.alerts].slice(0, 6);
  renderAlerts();
}

function currentRoute() {
  if (state.productionMapBlocked) {
    return {
      ok: false,
      reason: state.mapError || "Production map is unavailable.",
      path: [],
      meters: 0,
      etaMinutes: null,
      steps: []
    };
  }

  // Node ids from a previously loaded airport must never leak into routing
  // on the current map (e.g. after the live flight switches airports).
  if (!state.map.nodes.some((node) => node.id === state.fromNodeId)) {
    state.fromNodeId = defaultStartNode(state.map);
  }
  if (!state.map.nodes.some((node) => node.id === state.destinationNodeId)) {
    state.destinationNodeId = state.map.places.find((place) => place.kind === "gate")?.nodeId
      || state.map.nodes[0].id;
  }

  return routeBetween(state.map, state.fromNodeId, state.destinationNodeId, {
    accessible: state.accessible,
    positionConfidence: state.positionConfidence
  });
}

function render() {
  renderProviderStatus();
  renderFlight();
  renderWifi();
  renderAlerts();
  renderMap(currentRoute());
}

function renderProviderStatus() {
  if (!elements.providerHealth) return;
  const status = state.providerStatus;
  if (!status) {
    elements.providerHealth.textContent = "Checking providers";
    return;
  }
  const mode = status.productionMapsRequired ? "production required" : "fallback allowed";
  elements.providerHealth.textContent = `Flight: ${status.flight} | Map: ${status.airportMap} (${mode})`;
}

function renderFlight() {
  const leg = state.itinerary?.legs?.[0];
  if (!leg) {
    elements.flightCard.innerHTML = "<p>Enter a flight to load gate, terminal, and status.</p>";
    return;
  }

  elements.flightCard.innerHTML = [
    row("Flight", `${leg.airline} ${leg.flightNumber}`),
    row("Route", `${leg.origin || "unknown"} to ${leg.destination || "unknown"}`),
    row("Terminal / gate", `${leg.terminal || "n/a"} / ${leg.gate || "not published"}`),
    row("Status", leg.status),
    leg.position ? row("Live position", `${leg.position.lat.toFixed(2)}, ${leg.position.lon.toFixed(2)}`) : "",
    row("Provider mode", state.itinerary.providerMode || "demo"),
    row("Data source", `${leg.source}, ${new Date(leg.fetchedAt).toLocaleTimeString()}`)
  ].join("");
}

function renderWifi() {
  const profile = wifiProfileFor(state.map.airportCode);
  const capability = wifiCapability();
  elements.wifiCard.innerHTML = [
    row("Airport SSID", profile.ssid),
    row("Map source", state.productionMapBlocked ? "production map unavailable" : `${state.map.source || "unknown"} (${state.map.version})`),
    row("Map coverage", coverageSummary()),
    row("Mode", capability.canAutoJoin ? "Native auto-join available" : "Manual web assist"),
    row("Security", profile.security),
    `<p>${profile.instructions.join(" ")}</p>`
  ].join("");
}

function coverageSummary() {
  if (state.productionMapBlocked) return "blocked";
  const counts = state.mapDiagnostics?.counts;
  if (!counts) return "pending";
  return `${counts.gates} gates, ${counts.nodes} nodes, ${counts.edges} edges`;
}

function renderAlerts() {
  elements.alerts.innerHTML = state.alerts.map((alert) => `<li>${escapeHtml(alert)}</li>`).join("");
}

function mapBounds(map, padding = 70) {
  const xs = map.nodes.map((node) => node.x);
  const ys = map.nodes.map((node) => node.y);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return {
    minX,
    minY,
    width: Math.max(...xs) + padding - minX,
    height: Math.max(...ys) + padding - minY
  };
}

function renderMap(route) {
  if (elements.mapTitle) {
    elements.mapTitle.textContent = state.productionMapBlocked
      ? "Airport map"
      : state.map.name || state.map.airportCode || "Airport map";
  }

  if (state.productionMapBlocked) {
    elements.routeTitle.textContent = "Production map unavailable";
    elements.routeMeta.textContent = state.mapError || "Map provider is not configured.";
    elements.routeSteps.innerHTML = "<li>Configure a production airport map catalog or bundle host before routing.</li>";
    elements.map.setAttribute("viewBox", "0 0 920 560");
    elements.map.innerHTML = `
      <rect class="terminal-wall" x="34" y="92" width="852" height="384" rx="8"></rect>
      <text class="place-label" x="100" y="250">Production airport map required</text>
      <text class="place-label" x="100" y="290">${escapeHtml(state.mapError || "No production map loaded")}</text>
    `;
    return;
  }

  const map = state.map;
  if (!map.nodes.some((node) => node.id === state.fromNodeId)) {
    state.fromNodeId = defaultStartNode(map);
  }
  if (!map.nodes.some((node) => node.id === state.destinationNodeId)) {
    state.destinationNodeId = map.places.find((place) => place.kind === "gate")?.nodeId || map.nodes[0].id;
  }

  const routeNodes = route.path.map((nodeId) => getNode(map, nodeId));
  const activeGate = getNode(map, state.destinationNodeId).label;
  elements.routeTitle.textContent = route.ok ? `Route to gate ${activeGate}` : "No route available";
  elements.routeMeta.innerHTML = route.ok
    ? `${Math.round(route.meters)} m<br>${route.etaMinutes} min<br>${route.confidence} confidence`
    : escapeHtml(route.reason);

  elements.routeSteps.innerHTML = route.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");

  const bounds = mapBounds(map);
  elements.map.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);

  // Stroke widths, dot radii, and label sizes are expressed in viewBox units,
  // so real-world bundles (thousands of meters wide) need everything scaled
  // up relative to the 920-unit demo map the styles were designed around.
  const s = Math.max(0.4, bounds.width / 920);

  if (elements.mapAttribution) {
    elements.mapAttribution.textContent = state.map.attribution || "";
  }

  const routePath = routeNodes.map((node) => `${node.x},${node.y}`).join(" ");
  elements.map.innerHTML = `
    <rect class="terminal-wall" x="${bounds.minX + 16 * s}" y="${bounds.minY + 16 * s}" width="${bounds.width - 32 * s}" height="${bounds.height - 32 * s}" rx="${8 * s}"></rect>
    ${map.edges.map((edge) => renderEdge(map, edge, s)).join("")}
    ${route.ok ? `<polyline class="route-line" points="${routePath}" style="stroke-width:${10 * s}px"></polyline>` : ""}
    ${map.places.map((place) => renderPlace(map, place, s)).join("")}
    ${renderUserDot(map, s)}
  `;
}

function renderEdge(map, edge, s = 1) {
  const from = getNode(map, edge.from);
  const to = getNode(map, edge.to);
  const closed = isEdgeClosed(map, edge.from, edge.to) ? " closed" : "";
  return `<line class="map-edge${closed}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" style="stroke-width:${8 * s}px"></line>`;
}

function renderPlace(map, place, s = 1) {
  const node = getNode(map, place.nodeId);
  return `
    <circle class="place-dot" cx="${node.x}" cy="${node.y}" r="${11 * s}" style="stroke-width:${3 * s}px"></circle>
    <text class="place-label" x="${node.x + 15 * s}" y="${node.y + 6 * s}" style="font-size:${18 * s}px">${escapeHtml(place.label)}</text>
  `;
}

function renderUserDot(map, s = 1) {
  const node = getNode(map, state.fromNodeId);
  return `<circle class="user-dot" cx="${node.x}" cy="${node.y}" r="${13 * s}" style="stroke-width:${5 * s}px"></circle>`;
}

function row(label, value) {
  return `<div class="data-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

render();
