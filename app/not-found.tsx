import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

export default function NotFound() {
  return (
    <AuthShell>
      <div className="auth-card card">
        <p className="kicker">Missing</p>
        <h1>That page is not available</h1>
        <p className="lede">It may have been archived, or you may not have access.</p>
        <Link className="btn btn-primary" href="/dashboard">Back to the workspace</Link>
      </div>
    </AuthShell>
  );
}
