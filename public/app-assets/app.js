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
  tilt: true,
  view: null,
  viewAirport: null,
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
  mapLegend: document.querySelector("#map-legend"),
  tiltToggle: document.querySelector("#tilt-toggle"),
  resetView: document.querySelector("#reset-view"),
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
  setupMapNavigation();
  await Promise.all([loadProviderStatus(), loadAirportCatalog()]);
  await loadAirportMap(state.catalogCodes?.[0] || "DFW");
  render();
}

async function loadAirportCatalog() {
  if (!elements.airportSelect) return;
  try {
    const response = await fetch("/api/airport-map/catalog");
    const catalog = await response.json();
    const entries = (catalog.entries || [])
      .slice()
      .sort((a, b) => a.airportCode.localeCompare(b.airportCode));
    if (!entries.length) return;
    elements.airportSelect.innerHTML = entries
      .map((entry) => `<option value="${escapeHtml(entry.airportCode)}">${escapeHtml(entry.airportCode)}${entry.routing === "approximate" ? " ≈" : ""}</option>`)
      .join("");
    state.catalogCodes = entries.map((entry) => entry.airportCode);
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
    if (state.map.routing === "approximate") {
      addAlert(`${state.map.airportCode} has mapped gate positions only — guidance is approximate, follow airport signage.`);
    }
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
    || map.nodes.find((node) => node.kind === "gate")?.id
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

  // Gate-position-only bundles have no mapped corridors: give signage-based
  // guidance with an explicitly approximate distance instead of a fake route.
  if (state.map.routing === "approximate") {
    const from = getNode(state.map, state.fromNodeId);
    const to = getNode(state.map, state.destinationNodeId);
    const directMeters = Math.hypot(to.x - from.x, to.y - from.y);
    const meters = directMeters * 1.4;
    const etaMinutes = Math.max(1, Math.ceil(meters / 72));
    return {
      ok: true,
      approximate: true,
      path: [from.id, to.id],
      meters,
      etaMinutes,
      confidence: "approximate",
      steps: [
        `Follow airport signage toward gate ${to.label || state.map.airportCode}.`,
        `Approximate walk ${Math.round(meters)} m, about ${etaMinutes} min (straight-line estimate + typical detour).`,
        "This airport has real mapped gate positions but no indoor walkway data yet, so turn-by-turn routing is not available."
      ]
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

// ---- Blueprint 2.5D projection and navigation -----------------------------

const TILT_FACTOR = 0.62;
const TERMINAL_HEIGHT_METERS = 34;

function proj(x, y, z = 0) {
  return state.tilt ? [x, y * TILT_FACTOR - z] : [x, y];
}

function projPoints(points, z = 0) {
  return points
    .map(([x, y]) => proj(x, y, z).map((v) => Math.round(v * 10) / 10).join(","))
    .join(" ");
}

function projectedBounds(map, padding = 70) {
  const points = map.nodes.map((node) => proj(node.x, node.y));
  for (const polygon of map.layers?.terminals || []) {
    for (const point of polygon) points.push(proj(point[0], point[1]));
  }
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding - (state.tilt ? TERMINAL_HEIGHT_METERS : 0);
  return {
    minX,
    minY,
    width: Math.max(...xs) + padding - minX,
    height: Math.max(...ys) + padding - minY
  };
}

function applyView() {
  if (!state.view) return;
  elements.map.setAttribute("viewBox", `${state.view.x} ${state.view.y} ${state.view.w} ${state.view.h}`);
}

function resetView() {
  state.view = null;
  render();
}

function setupMapNavigation() {
  const svg = elements.map;
  if (!svg) return;

  svg.addEventListener("wheel", (event) => {
    if (!state.view) return;
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const factor = event.deltaY > 0 ? 1.18 : 1 / 1.18;
    const width = Math.min(Math.max(state.view.w * factor, 40), 60000);
    const height = width * (state.view.h / state.view.w);
    state.view.x += (state.view.w - width) * fx;
    state.view.y += (state.view.h - height) * fy;
    state.view.w = width;
    state.view.h = height;
    applyView();
  }, { passive: false });

  let drag = null;
  svg.addEventListener("pointerdown", (event) => {
    if (!state.view) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("dragging");
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id || !state.view) return;
    const rect = svg.getBoundingClientRect();
    state.view.x -= (event.clientX - drag.x) * (state.view.w / rect.width);
    state.view.y -= (event.clientY - drag.y) * (state.view.h / rect.height);
    drag = { id: drag.id, x: event.clientX, y: event.clientY };
    applyView();
  });
  const endDrag = () => {
    drag = null;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("dblclick", resetView);

  elements.resetView?.addEventListener("click", resetView);
  elements.tiltToggle?.addEventListener("click", () => {
    state.tilt = !state.tilt;
    elements.tiltToggle.setAttribute("aria-pressed", String(state.tilt));
    state.view = null;
    render();
  });
}

function renderBlueprintLayers(map, s) {
  const layers = map.layers || {};
  const parts = [];

  for (const apron of layers.aprons || []) {
    parts.push(`<polygon class="bp-apron" points="${projPoints(apron)}" stroke-width="${1.2 * s}"></polygon>`);
  }
  for (const taxiway of layers.taxiways || []) {
    parts.push(`<polyline class="bp-taxiway" points="${projPoints(taxiway)}" stroke-width="12"></polyline>`);
  }
  for (const runway of layers.runways || []) {
    parts.push(`<polyline class="bp-runway" points="${projPoints(runway.points)}" stroke-width="${runway.width}"></polyline>`);
    parts.push(`<polyline class="bp-runway-center" points="${projPoints(runway.points)}" stroke-width="${1.6 * s}" stroke-dasharray="30 22"></polyline>`);
  }

  const terminals = layers.terminals || [];
  for (const terminal of terminals) {
    parts.push(`<polygon class="bp-terminal-base" points="${projPoints(terminal)}"></polygon>`);
  }
  if (state.tilt) {
    // Stacked copies from ground to roof read as extruded walls.
    for (let step = 1; step <= 4; step += 1) {
      const z = (TERMINAL_HEIGHT_METERS * step) / 4;
      for (const terminal of terminals) {
        parts.push(`<polygon class="bp-terminal-wall" points="${projPoints(terminal, z)}" stroke-width="${0.8 * s}"></polygon>`);
      }
    }
  }
  for (const terminal of terminals) {
    parts.push(`<polygon class="bp-terminal-roof" points="${projPoints(terminal, state.tilt ? TERMINAL_HEIGHT_METERS : 0)}" stroke-width="${1.6 * s}"></polygon>`);
  }
  return parts.join("");
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
  elements.routeTitle.textContent = route.ok
    ? route.approximate
      ? `Toward gate ${activeGate} (approximate)`
      : `Route to gate ${activeGate}`
    : "No route available";
  elements.routeMeta.innerHTML = route.ok
    ? `${route.approximate ? "~" : ""}${Math.round(route.meters)} m<br>${route.etaMinutes} min<br>${route.confidence} confidence`
    : escapeHtml(route.reason);

  elements.routeSteps.innerHTML = route.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");

  const bounds = projectedBounds(map);
  // Initial view frames the gate/terminal area; the wider airfield
  // (runways, taxiways) is there to discover by zooming out.
  const focusPoints = map.nodes.map((node) => proj(node.x, node.y));
  const fxs = focusPoints.map((point) => point[0]);
  const fys = focusPoints.map((point) => point[1]);
  const focus = {
    x: Math.min(...fxs) - 90,
    y: Math.min(...fys) - 90 - (state.tilt ? TERMINAL_HEIGHT_METERS : 0),
    w: Math.max(...fxs) - Math.min(...fxs) + 180,
    h: Math.max(...fys) - Math.min(...fys) + 180
  };
  if (!state.view || state.viewAirport !== map.airportCode) {
    state.view = focus;
    state.viewAirport = map.airportCode;
  }
  applyView();

  // Stroke widths, dot radii, and label sizes are expressed in viewBox units,
  // scaled relative to the focused terminal area (not the full airfield) so
  // gates stay readable at the default zoom.
  const s = Math.max(0.4, focus.w / 920);

  if (elements.mapAttribution) {
    elements.mapAttribution.textContent = state.map.attribution || "";
  }
  if (elements.mapLegend) {
    elements.mapLegend.textContent = `${map.airportCode} · gate guide blueprint · drag to pan · scroll to zoom`;
  }

  // The blueprint paper and grid extend well past the data so panning never
  // reveals a hard edge.
  const gx = bounds.minX - bounds.width;
  const gy = bounds.minY - bounds.height;
  const gw = bounds.width * 3;
  const gh = bounds.height * 3;

  const routePath = projPoints(routeNodes.map((node) => [node.x, node.y]));
  elements.map.innerHTML = `
    <defs>
      <pattern id="bp-grid" width="100" height="100" patternUnits="userSpaceOnUse">
        <path d="M 100 0 L 0 0 0 100" fill="none" class="bp-grid-line" stroke-width="${0.7 * s}"></path>
      </pattern>
    </defs>
    <rect class="bp-paper" x="${gx}" y="${gy}" width="${gw}" height="${gh}"></rect>
    <rect fill="url(#bp-grid)" x="${gx}" y="${gy}" width="${gw}" height="${gh}"></rect>
    ${renderBlueprintLayers(map, s)}
    ${map.edges.map((edge) => renderEdge(map, edge, s)).join("")}
    ${route.ok ? `<polyline class="route-halo" points="${routePath}" stroke-width="${20 * s}"></polyline><polyline class="route-line" points="${routePath}" stroke-width="${8 * s}"${route.approximate ? ` stroke-dasharray="${14 * s} ${12 * s}" opacity="0.85"` : ""}></polyline>` : ""}
    ${map.places.map((place) => renderPlace(map, place, s)).join("")}
    ${renderUserDot(map, s)}
  `;
}

function renderEdge(map, edge, s = 1) {
  const from = proj(getNode(map, edge.from).x, getNode(map, edge.from).y);
  const to = proj(getNode(map, edge.to).x, getNode(map, edge.to).y);
  const closed = isEdgeClosed(map, edge.from, edge.to) ? " closed" : "";
  const dash = closed ? ` stroke-dasharray="${10 * s} ${8 * s}"` : "";
  return `<line class="map-edge${closed}" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" stroke-width="${5 * s}"${dash}></line>`;
}

function renderPlace(map, place, s = 1) {
  const node = getNode(map, place.nodeId);
  const [x, y] = proj(node.x, node.y);
  return `
    <circle class="place-dot bp-${place.kind}" cx="${x}" cy="${y}" r="${place.kind === "gate" ? 10 * s : 8 * s}" stroke-width="${2.5 * s}"></circle>
    <text class="place-label" x="${x + 14 * s}" y="${y + 6 * s}" font-size="${17 * s}">${escapeHtml(place.label)}</text>
  `;
}

function renderUserDot(map, s = 1) {
  const node = getNode(map, state.fromNodeId);
  const [x, y] = proj(node.x, node.y);
  return `<circle class="user-halo" cx="${x}" cy="${y}" r="${24 * s}"></circle><circle class="user-dot" cx="${x}" cy="${y}" r="${13 * s}" stroke-width="${5 * s}"></circle>`;
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
