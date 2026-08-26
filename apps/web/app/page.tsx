import { TerminalShell } from "../components/TerminalShell";

export default function Home() {
  const endpoint = process.env.NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT;
  const expectedWebOrigin = process.env.NEXT_PUBLIC_TERMINUS_WEB_ORIGIN;
  const protocolConfig =
    endpoint !== undefined && expectedWebOrigin !== undefined
      ? { endpoint, expectedWebOrigin }
      : undefined;
  return <TerminalShell protocolConfig={protocolConfig} />;
}
