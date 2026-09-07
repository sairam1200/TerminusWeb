import { IntelligencePage } from "../../components/IntelligencePage";
import { buildConnectProfilesFromEnv } from "../../protocol/connectConfig";
export default function Page() {
  return (
    <IntelligencePage page="billing" profiles={buildConnectProfilesFromEnv()} />
  );
}
