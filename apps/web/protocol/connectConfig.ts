import {
  type ConnectionMode,
  type PrivateWssPolicy,
  validateWssPolicy,
} from "./endpointPolicy";

export type { ConnectionMode };

export interface ConnectProfile extends PrivateWssPolicy {
  mode: ConnectionMode;
}

const LOCAL_STORAGE_KEY = "terminus.connect.profiles.v1";

export interface PersistedConnectProfile {
  mode: ConnectionMode;
  endpoint: string;
  expectedWebOrigin: string;
}

export interface PersistedConnectState {
  selectedMode: ConnectionMode;
  profiles: ConnectProfile[];
}

const EMPTY_STATE: PersistedConnectState = {
  selectedMode: "private",
  profiles: [],
};

export function buildConnectProfilesFromEnv(): ConnectProfile[] {
  const localEndpoint = process.env.NEXT_PUBLIC_TERMINUS_LOCAL_WSS_ENDPOINT;
  const localExpected = process.env.NEXT_PUBLIC_TERMINUS_LOCAL_WEB_ORIGIN;
  const privateEndpoint = process.env.NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT;
  const privateExpected = process.env.NEXT_PUBLIC_TERMINUS_WEB_ORIGIN;

  const profiles: ConnectProfile[] = [];

  if (localEndpoint && localExpected) {
    profiles.push({
      mode: "local",
      endpoint: localEndpoint,
      expectedWebOrigin: localExpected,
    });
  }

  if (privateEndpoint && privateExpected) {
    profiles.push({
      mode: "private",
      endpoint: privateEndpoint,
      expectedWebOrigin: privateExpected,
    });
  }

  return profiles;
}

export function parseDefaultMode(
  value: string | undefined,
): ConnectionMode | undefined {
  if (value === "local" || value === "private") return value;
  return undefined;
}

export function resolveProfiles(
  envProfiles: ConnectProfile[],
  savedState: PersistedConnectState | undefined,
): ConnectProfile[] {
  const profileByMode = new Map<ConnectionMode, ConnectProfile>();
  const savedProfiles = savedState?.profiles ?? EMPTY_STATE.profiles;
  const allProfiles = [...savedProfiles, ...envProfiles];
  for (const profile of allProfiles) {
    if (!isConnectProfile(profile)) continue;
    profileByMode.set(profile.mode, profile);
  }

  // Environment config is authoritative for a mode when present.
  for (const profile of envProfiles) {
    if (isConnectProfile(profile)) {
      profileByMode.set(profile.mode, profile);
    }
  }

  const mergedProfiles = [profileByMode.get("local"), profileByMode.get("private")]
    .filter((profile): profile is ConnectProfile => profile !== undefined);
  return mergedProfiles;
}

export function selectInitialProfile(
  profiles: ConnectProfile[],
  savedMode: ConnectionMode | undefined,
  defaultMode: ConnectionMode | undefined,
): ConnectProfile | undefined {
  if (profiles.length === 0) return undefined;
  if (
    savedMode &&
    profiles.some((profile) => profile.mode === savedMode)
  ) {
    return profiles.find((profile) => profile.mode === savedMode);
  }
  if (
    defaultMode &&
    profiles.some((profile) => profile.mode === defaultMode)
  ) {
    return profiles.find((profile) => profile.mode === defaultMode);
  }

  return profiles[0];
}

export function readPersistedConnectState(
): PersistedConnectState | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (raw === null) return undefined;

  try {
    const parsed = JSON.parse(raw) as PersistedConnectState | null;
    if (
      parsed === null ||
      !parsed.profiles ||
      !Array.isArray(parsed.profiles) ||
      !isConnectionMode(parsed.selectedMode)
    ) {
      return undefined;
    }

    const profiles = parsed.profiles
      .filter((profile) =>
        isConnectProfile({
          ...profile,
          mode: profile.mode,
        } as PersistedConnectProfile),
      )
      .map((profile) => ({
        mode: profile.mode,
        endpoint: profile.endpoint,
        expectedWebOrigin: profile.expectedWebOrigin,
      }));

    if (profiles.length === 0) return undefined;
    return { selectedMode: parsed.selectedMode, profiles };
  } catch {
    return undefined;
  }
}

export function persistConnectState(state: PersistedConnectState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
}

export function clearPersistedConnectState(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(LOCAL_STORAGE_KEY);
}

export function isConnectProfile(profile: PersistedConnectProfile): profile is ConnectProfile {
  if (!isConnectionMode(profile.mode)) return false;
  if (
    typeof profile.endpoint !== "string" ||
    typeof profile.expectedWebOrigin !== "string"
  ) {
    return false;
  }
  if (profile.endpoint.trim() === "" || profile.expectedWebOrigin.trim() === "") {
    return false;
  }
  try {
    validateWssPolicy(
      {
        mode: profile.mode,
        endpoint: profile.endpoint,
        expectedWebOrigin: profile.expectedWebOrigin,
      },
      profile.expectedWebOrigin,
    );
  } catch {
    return false;
  }
  return true;
}

function isConnectionMode(value: unknown): value is ConnectionMode {
  return value === "local" || value === "private";
}

export function profileLabel(profile: ConnectProfile): string {
  return profile.mode === "local"
    ? "Local mode (same machine)"
    : "Private mode (tailscale path)";
}
