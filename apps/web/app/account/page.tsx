import { IntelligencePage } from "../../components/IntelligencePage";
import { buildConnectProfilesFromEnv } from "../../protocol/connectConfig";
export default function Page() {
  return (
    <IntelligencePage page="account" profiles={buildConnectProfilesFromEnv()} />
  );
}
