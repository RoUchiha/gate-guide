export function getNativeBridge() {
  return globalThis.NativeAirportBridge || null;
}

export function wifiCapability(bridge = getNativeBridge()) {
  return {
    canAutoJoin: Boolean(bridge?.wifi?.joinTrustedNetwork),
    canOpenSettings: Boolean(bridge?.wifi?.openSettings),
    platform: bridge?.platform || "web"
  };
}

export async function connectToWifi(profile, bridge = getNativeBridge()) {
  if (!profile.trusted) {
    return { ok: false, status: "refused", message: "This network is not airport-verified." };
  }

  const capability = wifiCapability(bridge);
  if (capability.canAutoJoin) {
    return bridge.wifi.joinTrustedNetwork({
      ssid: profile.ssid,
      security: profile.security,
      captivePortalUrl: profile.captivePortalUrl
    });
  }

  if (capability.canOpenSettings) {
    await bridge.wifi.openSettings();
  }

  return {
    ok: false,
    status: "manual-required",
    message: `Open Wi-Fi settings and choose ${profile.ssid}.`
  };
}
