import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { initials } from "@/lib/text";

type Crumb = { href?: string; label: string };

export function PageHeader({ kicker, crumbs, title, lede, action, badges, facts, children }: { kicker?: string; crumbs?: Crumb[]; title: string; lede?: string; action?: React.ReactNode; badges?: React.ReactNode; facts?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {crumbs?.length ? (
          <nav className="kicker" aria-label="Breadcrumb">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="row" style={{ gap: 6 }}>
                {index > 0 ? <ChevronRight size={12} aria-hidden="true" /> : null}
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
              </span>
            ))}
          </nav>
        ) : kicker ? <p className="kicker">{kicker}</p> : null}
        <div className="title-row"><h1>{title}</h1>{badges}</div>
        {lede ? <p className="lede">{lede}</p> : null}
        {facts ? <div className="facts">{facts}</div> : null}
        {children}
      </div>
      {action ? <div className="page-actions">{action}</div> : null}
    </div>
  );
}

export function Panel({ title, description, actions, children, footer, flush, className, id }: { title?: React.ReactNode; description?: string; actions?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; flush?: boolean; className?: string; id?: string }) {
  return (
    <section className={className ? `panel ${className}` : "panel"} id={id}>
      {title || actions ? (
        <header className="panel-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="btn-group">{actions}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "panel-body flush" : "panel-body"}>{children}</div>
      {footer ? <footer className="panel-foot">{footer}</footer> : null}
    </section>
  );
}

export function Tabs({ items, label }: { items: Array<{ href: string; label: string; count?: number | null; current?: boolean; alert?: boolean }>; label: string }) {
  return (
    <nav className="tabbar" aria-label={label}>
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.current ? "page" : undefined}>
          {item.label}
          {item.count != null ? <span className={item.alert && item.count > 0 ? "tab-count alert" : "tab-count"}>{item.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function StatStrip({ items }: { items: Array<{ label: string; value: React.ReactNode; href?: string; hint?: string; tone?: "now" | "soon" | "" }> }) {
  return (
    <div className="stat-strip">
      {items.map((item) => {
        const body = (
          <>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.hint ? <small>{item.hint}</small> : null}
          </>
        );
        return item.href ? (
          <Link key={item.label} className={`stat-cell ${item.tone ?? ""}`} href={item.href}>{body}</Link>
        ) : (
          <div key={item.label} className={`stat-cell ${item.tone ?? ""}`}>{body}</div>
        );
      })}
    </div>
  );
}

export function Props({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="props">
      {items.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Drawer({ label, title, children, primary, wide, open, icon }: { label: string; title: string; children: React.ReactNode; primary?: boolean; wide?: boolean; open?: boolean; icon?: React.ReactNode }) {
  return (
    <details className="drawer" open={open}>
      <summary className={primary ? "btn btn-primary" : "btn btn-secondary"}>{icon}{label}</summary>
      <div className={wide ? "drawer-panel wide" : "drawer-panel"}>
        <div className="panel-head"><h2>{title}</h2></div>
        <div className="panel-body">{children}</div>
      </div>
    </details>
  );
}

export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <>
      <span className="num">{from}–{to} of {total}</span>
      <span className="pager">
        {page > 1 ? <Link className="btn btn-secondary btn-sm" href={href(page - 1)} aria-label="Previous page"><ChevronLeft size={14} aria-hidden="true" /></Link> : <span className="btn btn-secondary btn-sm" aria-disabled="true" style={{ opacity: .45 }}><ChevronLeft size={14} aria-hidden="true" /></span>}
        <span className="num">Page {page} of {pages}</span>
        {page < pages ? <Link className="btn btn-secondary btn-sm" href={href(page + 1)} aria-label="Next page"><ChevronRight size={14} aria-hidden="true" /></Link> : <span className="btn btn-secondary btn-sm" aria-disabled="true" style={{ opacity: .45 }}><ChevronRight size={14} aria-hidden="true" /></span>}
      </span>
    </>
  );
}

export function Person({ name, inactive, empty = "Unassigned" }: { name?: string | null; inactive?: boolean; empty?: string }) {
  if (!name) return <span className="person muted"><span className="avatar none" aria-hidden="true">–</span><span>{empty}</span></span>;
  return (
    <span className="person">
      <span className="avatar" aria-hidden="true">{initials(name)}</span>
      <span>{name}{inactive ? <span className="meta"> · inactive</span> : null}</span>
    </span>
  );
}

export function Score({ value }: { value: number }) {
  return <span className={value >= 70 ? "score hot" : value >= 40 ? "score warm" : "score"}>{value}</span>;
}

export function Badge({ value }: { value: string }) {
  const tone = /^un(qualified|assigned)$/.test(value)
    ? "info"
    : /critical|blocked|overdue|rejected|failed|at_risk|cancelled|inactive|action|lost|bounced/.test(value)
    ? "bad"
    : /warn|hold|pending|watch|proposed|negotiation|soon|nurturing|dormant|high/.test(value)
      ? "warn"
      : /done|approved|active|healthy|sent|delivered|verified|completed|converted|won|qualified|assigned/.test(value)
        ? "good"
        : "info";
  return <span className={`badge ${tone}`}>{value.replaceAll("_", " ")}</span>;
}

export function Empty({ title, body, href, action }: { title: string; body: string; href?: string; action?: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p className="lede">{body}</p>
      {href && action ? <p><Link className="btn btn-primary" href={href}>{action}</Link></p> : null}
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{initials(name)}</span>;
}

export function SubmitButton({ label, pendingLabel = "Saving…" }: { label: string; pendingLabel?: string }) {
  return <button className="btn btn-primary" type="submit">{label}<span className="sr-only">{pendingLabel}</span></button>;
}
