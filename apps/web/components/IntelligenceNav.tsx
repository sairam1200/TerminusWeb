import Link from "next/link";
export function IntelligenceNav() {
  return (
    <nav className="intelligenceNav" aria-label="Workspace navigation">
      <Link href="/">Terminal</Link>
      <Link href="/history">History</Link>
      <Link href="/usage">Usage</Link>
      <Link href="/account">Account</Link>
      <Link href="/account/privacy">Privacy</Link>
      <Link href="/billing">Plan</Link>
      <Link href="/admin">Admin</Link>
    </nav>
  );
}
