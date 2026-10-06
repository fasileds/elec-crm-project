import Link from "next/link";
import { Plus } from "lucide-react";
import { archiveCustomerAction } from "@/app/actions";
import { ContactForm } from "@/components/contact-form";
import { Badge, Drawer, PageHeader, Panel, Person, Props } from "@/components/ui";
import { can } from "@/lib/actor";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getCustomer } from "@/lib/domain/customers";
import { requireEmployee } from "@/lib/session";

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireEmployee();
  const { id } = await params;
  const customer = await getCustomer(actor, id);
  const activeProjects = customer.projects.filter((project) => !["completed", "cancelled", "archived"].includes(project.status));

  return (
    <main>
      <PageHeader
        crumbs={[{ href: "/customers", label: "Customers" }, { label: customer.code }]}
        title={customer.name}
        badges={<><Badge value={customer.status} />{customer.archivedAt && customer.status !== "archived" ? <Badge value="archived" /> : null}</>}
        facts={
          <>
            {customer.industry ? <span>{customer.industry}</span> : null}
            {customer.website ? <span><a href={customer.website.startsWith("http") ? customer.website : `https://${customer.website}`} target="_blank" rel="noreferrer">{customer.website.replace(/^https?:\/\//, "")}</a></span> : null}
            <span>{customer.projectCount} projects · {customer.contactCount} contacts</span>
          </>
        }
        action={can(actor, "projects.create") && !customer.archivedAt ? <Link className="btn btn-primary" href={`/projects/new?customerId=${customer.id}`}><Plus size={15} aria-hidden="true" />New project</Link> : null}
      />

      {customer.archivedAt ? <p className="alert warn" style={{ marginBottom: 16 }}>Archived {formatDateTime(customer.archivedAt, actor.timezone, actor.locale)}. Projects, contacts and history are kept and can be restored.</p> : null}

      <div className="record">
        <div className="record-main">
          <Panel title="Projects" description={`${activeProjects.length} in progress`} flush>
            {customer.projects.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>No projects yet for this account.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Project</th><th>Status</th><th>Health</th><th>Due</th></tr></thead>
                  <tbody>
                    {customer.projects.map((project) => (
                      <tr key={project.id}>
                        <td><Link href={`/projects/${project.id}`}><strong>{project.name}</strong></Link><div className="meta">{project.code}</div></td>
                        <td><Badge value={project.status} /></td>
                        <td><span className="row" style={{ justifyContent: "flex-start", gap: 8 }}><Badge value={project.healthStatus} /><span className="num meta">{project.healthScore}</span></span></td>
                        <td className="nowrap">{project.dueOn ? formatDate(project.dueOn, actor.timezone, actor.locale) : <span className="meta">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel
            title="Contacts"
            flush
            actions={can(actor, "customers.edit") && !customer.archivedAt ? (
              <Drawer label="Add contact" title={`New contact for ${customer.name}`} icon={<Plus size={14} aria-hidden="true" />}><ContactForm customerId={customer.id} /></Drawer>
            ) : null}
          >
            {customer.contacts.length === 0 ? <p className="meta" style={{ padding: "14px 16px" }}>Add the people who can speak for this account.</p> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Phone</th></tr></thead>
                  <tbody>
                    {customer.contacts.map((contact) => (
                      <tr key={contact.id}>
                        <td><Person name={contact.name} /> {contact.isPrimary ? <Badge value="primary" /> : null}</td>
                        <td>{contact.title || <span className="meta">—</span>}</td>
                        <td>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : <span className="meta">—</span>}</td>
                        <td className="nowrap">{contact.phone ?? <span className="meta">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Activity">
            <ol className="timeline">
              {customer.activities.length === 0 ? <li><span className="dot" /><span className="meta">No activity yet.</span></li> : customer.activities.map((activity) => (
                <li key={activity.id}><span className="dot" /><div><strong>{activity.summary}</strong><div className="meta">{activity.actorName} · {formatDateTime(activity.createdAt, actor.timezone, actor.locale)}{activity.visibility === "customer" ? " · visible to customer" : ""}</div></div></li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="record-aside">
          <Panel title="Account">
            <Props items={[
              ["Account manager", <Person key="manager" name={customer.accountManager?.name} inactive={customer.accountManager?.status === "inactive"} />],
              ["Type", <span key="kind" style={{ textTransform: "capitalize" }}>{customer.kind}</span>],
              ["Industry", customer.industry ?? "—"],
              ["Source", customer.source ?? "—"],
              ["Category", customer.category ?? "—"],
              ["Tags", customer.tags.length ? <span key="tags" className="row" style={{ justifyContent: "flex-start", gap: 4, flexWrap: "wrap" }}>{customer.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</span> : "—"],
              ["Updated", formatDate(customer.updatedAt, actor.timezone, actor.locale)],
            ]} />
          </Panel>

          {customer.addresses.length ? (
            <Panel title="Addresses">
              {customer.addresses.map((address) => (
                <p key={address.id} style={{ margin: "0 0 8px" }}>{[address.line1, address.line2, address.city, address.region, address.postalCode, address.country].filter(Boolean).join(", ")}</p>
              ))}
            </Panel>
          ) : null}

          {customer.notes ? <Panel title="Notes"><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{customer.notes}</p></Panel> : null}

          {can(actor, "customers.archive") ? (
            <Panel title={customer.archivedAt ? "Restore account" : "Archive account"} className="danger-zone">
              <form action={archiveCustomerAction} className="form">
                <input type="hidden" name="id" value={customer.id} />
                <input type="hidden" name="restore" value={customer.archivedAt ? "1" : "0"} />
                <label className="check"><input type="checkbox" name="confirm" required /> {customer.archivedAt ? "Return this customer to operational views." : "Archive is reversible. History, projects and comments stay."}</label>
                <div className="form-actions"><button className={customer.archivedAt ? "btn btn-secondary" : "btn btn-danger"} type="submit">{customer.archivedAt ? "Restore customer" : "Archive customer"}</button></div>
              </form>
            </Panel>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
