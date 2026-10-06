"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BarChart3, Bell, Briefcase, Building2, CheckCheck, ChevronDown, ChevronRight, Clock3, FileText, FolderKanban, LayoutDashboard, LogOut, Megaphone, Menu, Plus, Search, Settings, Target, UserPlus, Users, UsersRound } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { Logo } from "@/components/brand";

type Allow = (permissions: string[]) => boolean;
type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; allow?: Allow };
type NavGroup = { label: string; items: NavItem[] };

const has = (...keys: string[]): Allow => (permissions) => keys.some((key) => permissions.includes(key));

const EMPLOYEE: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/reports", label: "Reports", icon: BarChart3, allow: has("reports.view") },
    ],
  },
  {
    label: "Sales & marketing",
    items: [
      { href: "/leads", label: "Leads", icon: UserPlus, allow: has("leads.view") },
      { href: "/opportunities", label: "Opportunities", icon: Target, allow: has("opportunities.view") },
      { href: "/customers", label: "Customers", icon: Building2, allow: has("customers.view") },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, allow: has("campaigns.view") },
    ],
  },
  {
    label: "Delivery",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban, allow: has("projects.view", "tasks.view") },
      { href: "/work", label: "Tasks", icon: Briefcase, allow: has("tasks.view") },
      { href: "/approvals", label: "Approvals", icon: CheckCheck, allow: has("approvals.decide") },
      { href: "/time", label: "Time", icon: Clock3, allow: has("time.view", "time.log") },
      { href: "/documents", label: "Documents", icon: FileText, allow: has("documents.view") },
    ],
  },
  {
    label: "Organization",
    items: [
      { href: "/people", label: "People", icon: UsersRound, allow: has("employees.view") },
      { href: "/settings", label: "Settings", icon: Settings, allow: has("settings.manage", "audit.view") },
    ],
  },
];

const PORTAL: NavGroup[] = [
  {
    label: "Your account",
    items: [
      { href: "/portal", label: "Home", icon: LayoutDashboard },
      { href: "/portal/projects", label: "Projects", icon: FolderKanban },
      { href: "/portal/documents", label: "Documents", icon: FileText },
      { href: "/portal/approvals", label: "Approvals", icon: CheckCheck },
    ],
  },
];

const CREATE = [
  { href: "/leads?new=1", label: "Lead", icon: UserPlus, allow: has("leads.create") },
  { href: "/customers/new", label: "Customer", icon: Building2, allow: has("customers.create") },
  { href: "/projects/new", label: "Project", icon: FolderKanban, allow: has("projects.create") },
  { href: "/campaigns?new=1", label: "Campaign", icon: Megaphone, allow: has("campaigns.manage") },
];

function isCurrent(pathname: string, href: string) {
  if (href === "/dashboard" || href === "/portal") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function Shell({ children, name, email, unread, portal, organization, permissions = [], searchPath = "/search" }: { children: React.ReactNode; name: string; email: string; unread: number; portal?: boolean; organization: string; permissions?: string[]; searchPath?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = (portal ? PORTAL : EMPLOYEE)
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.allow || item.allow(permissions)) }))
    .filter((group) => group.items.length > 0);
  const creatable = portal ? [] : CREATE.filter((item) => item.allow(permissions));
  const activeGroup = groups.find((group) => group.items.some((item) => isCurrent(pathname, item.href)));
  const activeItem = activeGroup?.items.find((item) => isCurrent(pathname, item.href));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        document.querySelectorAll<HTMLDetailsElement>("details.menu[open], details.drawer[open]").forEach((node) => node.removeAttribute("open"));
      }
    }
    function onClick(event: MouseEvent) {
      document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((node) => {
        if (!node.contains(event.target as Node)) node.removeAttribute("open");
      });
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className={open ? "sidebar open" : "sidebar"} aria-label={portal ? "Client portal" : "Workspace"}>
        <div className="side-brand"><Logo /></div>
        <div className="side-org">
          <span className="org-mark" aria-hidden="true">{initialsOf(organization)}</span>
          <div><strong>{organization}</strong><span>{portal ? "Client portal" : "Workspace"}</span></div>
        </div>
        <nav className="side-nav" aria-label={portal ? "Client" : "Workspace"}>
          {groups.map((group) => (
            <div key={group.label}>
              <p className="side-group">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} className="nav-link" href={item.href} aria-current={isCurrent(pathname, item.href) ? "page" : undefined} onClick={() => setOpen(false)}>
                    <Icon size={16} aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <p className="sidebar-foot">Elec Novatech PLC</p>
      </aside>
      {open ? <button className="scrim" type="button" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" type="button" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="crumbs">
            <span>{activeGroup?.label ?? (portal ? "Your account" : "Workspace")}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{activeItem?.label ?? (pathname.startsWith("/search") || pathname.startsWith("/portal/search") ? "Search" : pathname.includes("notifications") ? "Notifications" : "Overview")}</strong>
          </div>
          <form className="search" action={searchPath} role="search">
            <label className="sr-only" htmlFor="global-search">Search</label>
            <Search size={15} aria-hidden="true" />
            <input ref={searchRef} id="global-search" name="q" type="search" placeholder={portal ? "Search projects and documents" : "Search leads, customers, projects…"} />
            <span className="kbd" aria-hidden="true">Ctrl K</span>
          </form>
          <div className="top-actions">
            {creatable.length ? (
              <details className="menu">
                <summary className="btn btn-primary"><Plus size={15} aria-hidden="true" />Create<ChevronDown size={14} aria-hidden="true" /></summary>
                <div className="menu-panel">
                  {creatable.map((item) => {
                    const Icon = item.icon;
                    return <Link key={item.href} className="menu-item" href={item.href}><Icon size={15} aria-hidden="true" />New {item.label.toLowerCase()}</Link>;
                  })}
                </div>
              </details>
            ) : null}
            <Link className="icon-btn bell" href={portal ? "/portal/notifications" : "/notifications"} aria-label={`Notifications, ${unread} unread`}>
              <Bell size={17} aria-hidden="true" />
              {unread > 0 ? <span className="count">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
            <details className="menu">
              <summary className="user-btn" aria-label="Account menu">
                <span className="avatar" aria-hidden="true">{initialsOf(name)}</span>
                <span className="user-name">{name.split(" ")[0]}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <div className="menu-panel">
                <div className="menu-head"><strong>{name}</strong><span>{email}</span></div>
                <Link className="menu-item" href={portal ? "/portal/notifications" : "/notifications"}><Bell size={15} aria-hidden="true" />Notifications</Link>
                {!portal && permissions.includes("leads.view") ? <Link className="menu-item" href="/leads?view=mine"><Users size={15} aria-hidden="true" />My assigned leads</Link> : null}
                {!portal && permissions.includes("tasks.view") ? <Link className="menu-item" href="/work?mine=1"><Briefcase size={15} aria-hidden="true" />My tasks</Link> : null}
                <div className="menu-sep" />
                <form action={logoutAction}>
                  <button className="menu-item" type="submit"><LogOut size={15} aria-hidden="true" />Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </header>
        <div className="content" id="content">{children}</div>
      </div>
    </div>
  );
}
