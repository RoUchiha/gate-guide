import { demoAirportMap, airportWifiProfiles } from "./sample-data.js";
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
  locateSecurity: document.querySelector("#locate-security"),
  locateArrival: document.querySelector("#locate-arrival"),
  useGps: document.querySelector("#use-gps")
};

elements.flightDate.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

bootstrap();

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  addAlert("Resolving flight with configured provider.");
  const itinerary = await state.provider.resolveFlight({
    airline: elements.airline.value.trim().toUpperCase(),
    flightNumber: elements.flightNumber.value.trim(),
    date: elements.flightDate.value
  });
  await applyItinerary(itinerary);

  window.setTimeout(() => {
    if (!state.itinerary || state.itinerary.providerMode === "live") return;
    void applyItinerary(state.provider.simulateGateChange(state.itinerary, "A21"));
    addAlert("Demo gate changed to A21. Route recalculated.");
  }, 8000);
});

elements.accessibleMode.addEventListener("change", () => {
  state.accessible = elements.accessibleMode.checked;
  render();
});

elements.locateSecurity.addEventListener("click", () => setManualStart("security-a"));
elements.locateArrival.addEventListener("click", () => setManualStart("arrival-a"));

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
  const result = await connectToWifi(airportWifiProfiles[0]);
  addAlert(result.message || (result.ok ? "Wi-Fi connection started." : "Wi-Fi connection needs manual setup."));
  renderWifi();
});

function setManualStart(nodeId) {
  const reading = manualReading(getNode(state.map, nodeId));
  state.fromNodeId = nodeId;
  state.positionConfidence = confidenceForReading(reading);
  addAlert(`Start set to ${getNode(state.map, nodeId).label}.`);
  render();
}

async function bootstrap() {
  await Promise.all([loadProviderStatus(), loadAirportMap("DFW")]);
  render();
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
    row("Route", `${leg.origin} to ${leg.destination}`),
    row("Terminal / gate", `${leg.terminal} / ${leg.gate}`),
    row("Status", leg.status),
    row("Provider mode", state.itinerary.providerMode || "demo"),
    row("Data source", `${leg.source}, ${new Date(leg.fetchedAt).toLocaleTimeString()}`)
  ].join("");
}

function renderWifi() {
  const profile = airportWifiProfiles[0];
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

function renderMap(route) {
  if (state.productionMapBlocked) {
    elements.routeTitle.textContent = "Production map unavailable";
    elements.routeMeta.textContent = state.mapError || "Map provider is not configured.";
    elements.routeSteps.innerHTML = "<li>Configure a production airport map catalog or bundle host before routing.</li>";
    elements.map.innerHTML = `
      <rect class="terminal-wall" x="34" y="92" width="852" height="384" rx="8"></rect>
      <text class="place-label" x="100" y="250">Production airport map required</text>
      <text class="place-label" x="100" y="290">${escapeHtml(state.mapError || "No production map loaded")}</text>
    `;
    return;
  }

  const map = state.map;
  const routeNodes = route.path.map((nodeId) => getNode(map, nodeId));
  const activeGate = getNode(map, state.destinationNodeId).label;
  elements.routeTitle.textContent = route.ok ? `Route to gate ${activeGate}` : "No route available";
  elements.routeMeta.innerHTML = route.ok
    ? `${Math.round(route.meters)} m<br>${route.etaMinutes} min<br>${route.confidence} confidence`
    : route.reason;

  elements.routeSteps.innerHTML = route.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");

  const routePath = routeNodes.map((node) => `${node.x},${node.y}`).join(" ");
  elements.map.innerHTML = `
    <rect class="terminal-wall" x="34" y="92" width="852" height="384" rx="8"></rect>
    <rect class="terminal-zone" x="62" y="124" width="230" height="310" rx="6"></rect>
    <rect class="terminal-zone" x="314" y="124" width="540" height="310" rx="6"></rect>
    ${map.edges.map((edge) => renderEdge(map, edge)).join("")}
    ${route.ok ? `<polyline class="route-line" points="${routePath}"></polyline>` : ""}
    ${map.places.map((place) => renderPlace(map, place)).join("")}
    ${renderUserDot(map)}
  `;
}

function renderEdge(map, edge) {
  const from = getNode(map, edge.from);
  const to = getNode(map, edge.to);
  const closed = isEdgeClosed(map, edge.from, edge.to) ? " closed" : "";
  return `<line class="map-edge${closed}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
}

function renderPlace(map, place) {
  const node = getNode(map, place.nodeId);
  return `
    <circle class="place-dot" cx="${node.x}" cy="${node.y}" r="11"></circle>
    <text class="place-label" x="${node.x + 15}" y="${node.y + 6}">${escapeHtml(place.label)}</text>
  `;
}

function renderUserDot(map) {
  const node = getNode(map, state.fromNodeId);
  return `<circle class="user-dot" cx="${node.x}" cy="${node.y}" r="13"></circle>`;
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
