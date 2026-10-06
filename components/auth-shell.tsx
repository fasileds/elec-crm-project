import { Logo } from "@/components/brand";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-wrap" id="content">
      <section className="auth-story">
        <div className="logo-plate"><Logo size="auth" /></div>
        <div className="story-copy">
          <h1>The operating system for customer work and delivery.</h1>
          <p>Leads, scope, milestones, approvals, and customer conversations stay in one place. Internal notes never leave the company.</p>
          <ul className="auth-points">
            <li>Lead routing, scoring and audited ownership</li>
            <li>Projects with health, scope baselines and approvals</li>
            <li>A client portal that only shows what you share</li>
          </ul>
        </div>
        <p className="auth-foot">Elec Novatech PLC · AI solutions for smarter businesses</p>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  );
}
