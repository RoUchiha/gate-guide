export const demoAirportMap = {
  airportCode: "DFW",
  name: "DFW Demo Terminal A",
  version: "2026.07.demo",
  source: "airport-validated-demo-bundle",
  scale: { unit: "meter", pixelsPerMeter: 3 },
  origin: { minLon: -97.03843, maxLat: 32.90651, metersPerDegLon: 93470 },
  floors: [{ id: "F1", label: "Departures" }],
  nodes: [
    { id: "arrival-a", floorId: "F1", x: 70, y: 430, kind: "arrival", label: "Arrival A" },
    { id: "security-a", floorId: "F1", x: 120, y: 270, kind: "security", label: "Security" },
    { id: "junction-a1", floorId: "F1", x: 250, y: 270, kind: "junction", label: "A junction" },
    { id: "food-court", floorId: "F1", x: 390, y: 190, kind: "amenity", label: "Food" },
    { id: "junction-a2", floorId: "F1", x: 470, y: 270, kind: "junction", label: "Concourse" },
    { id: "lounge-a", floorId: "F1", x: 570, y: 160, kind: "amenity", label: "Lounge" },
    { id: "gate-a12", floorId: "F1", x: 610, y: 360, kind: "gate", label: "A12" },
    { id: "gate-a18", floorId: "F1", x: 760, y: 270, kind: "gate", label: "A18" },
    { id: "gate-a21", floorId: "F1", x: 840, y: 165, kind: "gate", label: "A21" },
    { id: "elevator-a", floorId: "F1", x: 250, y: 390, kind: "elevator", label: "Elevator" }
  ],
  edges: [
    { from: "arrival-a", to: "security-a", meters: 62, accessible: true },
    { from: "security-a", to: "junction-a1", meters: 43, accessible: true },
    { from: "junction-a1", to: "food-court", meters: 55, accessible: true },
    { from: "food-court", to: "junction-a2", meters: 42, accessible: true },
    { from: "junction-a1", to: "junction-a2", meters: 74, accessible: false },
    { from: "junction-a1", to: "elevator-a", meters: 38, accessible: true },
    { from: "elevator-a", to: "gate-a12", meters: 120, accessible: true },
    { from: "junction-a2", to: "lounge-a", meters: 46, accessible: true },
    { from: "junction-a2", to: "gate-a12", meters: 54, accessible: true },
    { from: "junction-a2", to: "gate-a18", meters: 95, accessible: true },
    { from: "gate-a18", to: "gate-a21", meters: 48, accessible: true }
  ],
  closures: [
    { edgeKey: "food-court::junction-a2", reason: "Retail construction", until: "2099-01-01T00:00:00Z" }
  ],
  places: [
    { id: "arrival-a", kind: "arrival", label: "Arrival A", nodeId: "arrival-a" },
    { id: "security-a", kind: "security", label: "Security", nodeId: "security-a" },
    { id: "food-court", kind: "amenity", label: "Food", nodeId: "food-court" },
    { id: "lounge-a", kind: "amenity", label: "Lounge", nodeId: "lounge-a" },
    { id: "gate-a12", kind: "gate", label: "A12", nodeId: "gate-a12" },
    { id: "gate-a18", kind: "gate", label: "A18", nodeId: "gate-a18" },
    { id: "gate-a21", kind: "gate", label: "A21", nodeId: "gate-a21" }
  ]
};

export const airportWifiProfiles = [
  {
    ssid: "DFW Airport Free WiFi",
    airportCode: "DFW",
    security: "open-captive-portal",
    captivePortalUrl: "https://www.dfwairport.com/wifi/",
    trusted: true,
    instructions: [
      "Open Wi-Fi settings.",
      "Choose DFW Airport Free WiFi.",
      "Return here after accepting the portal terms."
    ]
  }
];

// Returns the curated Wi-Fi profile for an airport, or honest generic
// guidance when we have no verified SSID for it — never a fabricated network.
export function wifiProfileFor(airportCode) {
  const known = airportWifiProfiles.find((profile) => profile.airportCode === airportCode);
  if (known) return known;
  return {
    ssid: "Official airport Wi-Fi (check signage)",
    airportCode,
    security: "unknown",
    trusted: false,
    instructions: [
      "Open Wi-Fi settings.",
      "Choose the airport's official free network as posted on terminal signage.",
      "Return here after connecting."
    ]
  };
}
