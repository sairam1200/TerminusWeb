import { TerminalShell } from "../components/TerminalShell";
import {
  buildConnectProfilesFromEnv,
  parseDefaultMode,
} from "../protocol/connectConfig";

export default function Home() {
  const connectProfiles = buildConnectProfilesFromEnv();
  const defaultMode = parseDefaultMode(
    process.env.NEXT_PUBLIC_TERMINUS_CONNECT_MODE,
  );
  return (
    <TerminalShell
      protocolProfiles={connectProfiles}
      defaultMode={defaultMode}
    />
  );
}
