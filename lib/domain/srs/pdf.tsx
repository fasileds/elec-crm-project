import { readFile } from "node:fs/promises";
import path from "node:path";
import { Document, Image, Page, StyleSheet, Svg, Polygon, Line, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { ORIGIN_LABELS, PRIORITY_LABELS, QA_LABELS, type Origin } from "@/lib/domain/srs/catalog";
import type { DocBlock, DocItem, DocModel } from "@/lib/domain/srs/model";

const ink = "#16181d";
const muted = "#5b6372";
const line = "#d9dde4";

const styles = StyleSheet.create({
  // react-pdf re-resolves inherited unitless lineHeight on `fixed` nodes for every page split,
  // compounding it until pdfkit overflows, so lineHeight lives on the flowing body instead.
  page: { paddingTop: 64, paddingBottom: 56, paddingHorizontal: 52, fontFamily: "Helvetica", fontSize: 9.5, color: ink },
  body: { lineHeight: 1.45 },
  cover: { paddingTop: 72, paddingBottom: 56, paddingHorizontal: 60, fontFamily: "Helvetica", fontSize: 10, color: ink },
  header: { position: "absolute", top: 22, left: 52, right: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 0.6, borderBottomColor: line, paddingBottom: 6 },
  headerText: { fontSize: 7.5, color: muted },
  footer: { position: "absolute", bottom: 22, left: 52, right: 52, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.6, borderTopColor: line, paddingTop: 6, fontSize: 7.5, color: muted },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  h2: { fontSize: 11.5, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  caption: { fontSize: 7.5, color: muted, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 4, marginBottom: 2 },
  para: { marginBottom: 6 },
  notice: { marginVertical: 4, padding: 6, backgroundColor: "#f3f5f8", color: muted, fontSize: 8.5 },
  table: { borderWidth: 0.6, borderColor: line, marginVertical: 5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: line },
  th: { flex: 1, padding: 4, fontFamily: "Helvetica-Bold", fontSize: 8, backgroundColor: "#f3f5f8" },
  td: { flex: 1, padding: 4, fontSize: 8.5 },
  item: { borderLeftWidth: 2, paddingLeft: 8, marginVertical: 6 },
  itemHead: { flexDirection: "row", gap: 6, alignItems: "baseline" },
  itemKey: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  itemTitle: { fontFamily: "Helvetica-Bold", fontSize: 9.5, flex: 1 },
  meta: { fontSize: 7.5, color: muted, marginBottom: 3 },
  field: { flexDirection: "row", marginBottom: 1.5 },
  fieldLabel: { width: 120, color: muted, fontSize: 8.5 },
  fieldValue: { flex: 1, fontSize: 8.5 },
  criterion: { marginTop: 2, padding: 4, backgroundColor: "#f7f8fa", fontSize: 8.5 },
  toc: { flexDirection: "row", marginBottom: 3 },
  watermark: { position: "absolute", top: 360, left: 0, right: 0, textAlign: "center", fontSize: 64, color: "#c62828", opacity: 0.09, fontFamily: "Helvetica-Bold", transform: "rotate(-30deg)" },
  stepBox: { borderWidth: 0.8, borderColor: line, padding: 5, marginHorizontal: 30 },
  decision: { borderWidth: 0.8, borderColor: "#b26a00", backgroundColor: "#fff8ec", padding: 5, marginHorizontal: 30 },
});

let logo: Buffer | null = null;
async function logoBytes() {
  logo ??= await readFile(path.join(process.cwd(), "public", "brand", "logo.jpg"));
  return logo;
}

function Lines({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, index) => (
        <Text key={index} style={styles.para}>
          {para}
        </Text>
      ))}
    </>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tr} wrap={false}>
        {columns.map((column) => (
          <Text key={column} style={styles.th}>
            {column}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={styles.tr} wrap={false}>
          {row.map((cell, c) => (
            <Text key={c} style={styles.td}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Arrow() {
  return (
    <Svg width={12} height={14} style={{ alignSelf: "center", marginVertical: 1 }}>
      <Line x1={6} y1={0} x2={6} y2={9} stroke={muted} strokeWidth={1} />
      <Polygon points="2,8 10,8 6,14" fill={muted} />
    </Svg>
  );
}

function Workflow({ item, accent }: { item: DocItem; accent: string }) {
  const steps = item.steps ?? [];
  if (!steps.length) return null;
  return (
    <View style={{ marginTop: 4 }}>
      {steps.map((step, index) => (
        <View key={step.id} wrap={false}>
          {index > 0 && <Arrow />}
          <View style={step.type === "decision" ? styles.decision : [styles.stepBox, { borderLeftWidth: 2, borderLeftColor: accent }]}>
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 8.5 }}>
              {step.id}. {step.type === "decision" ? "Decision: " : ""}
              {step.action}
            </Text>
            <Text style={styles.meta}>
              {[step.actor && `Actor: ${step.actor}`, step.input && `Input: ${step.input}`, step.output && `Output: ${step.output}`, step.type === "decision" && step.yes && `Yes: go to ${step.yes}`, step.type === "decision" && step.no && `No: go to ${step.no}`].filter(Boolean).join("   ")}
            </Text>
            {step.exception ? <Text style={{ fontSize: 8, color: "#b3261e" }}>Exception: {step.exception}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function Item({ item, accent }: { item: DocItem; accent: string }) {
  return (
    <View style={[styles.item, { borderLeftColor: accent }]}>
      <View wrap={false} minPresenceAhead={40}>
        <View style={styles.itemHead}>
          <Text style={styles.itemKey}>{item.key}</Text>
          <Text style={styles.itemTitle}>{item.title}</Text>
        </View>
        <Text style={styles.meta}>
          {[PRIORITY_LABELS[item.priority] ?? item.priority, item.status.replaceAll("_", " "), ORIGIN_LABELS[item.origin as Origin] ?? item.origin].join("  ·  ")}
        </Text>
      </View>
      {item.description ? <Lines text={item.description} /> : null}
      {item.fields.map(([label, value]) => (
        <View key={label} style={styles.field}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.fieldValue}>{value}</Text>
        </View>
      ))}
      {item.kind === "workflow" ? <Workflow item={item} accent={accent} /> : null}
      {item.criteria.map((criterion, index) => (
        <View key={index} style={styles.criterion} wrap={false}>
          <Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>AC{index + 1} </Text>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Given </Text>
            {criterion.given} <Text style={{ fontFamily: "Helvetica-Bold" }}>When </Text>
            {criterion.when} <Text style={{ fontFamily: "Helvetica-Bold" }}>Then </Text>
            {criterion.then}
          </Text>
          <Text style={styles.meta}>QA: {QA_LABELS[criterion.qa] ?? criterion.qa}</Text>
        </View>
      ))}
    </View>
  );
}

function Block({ block, accent }: { block: DocBlock; accent: string }) {
  if (block.type === "text")
    return (
      <View>
        {block.caption ? <Text style={styles.caption}>{block.caption}</Text> : null}
        <Lines text={block.text} />
      </View>
    );
  if (block.type === "notice") return <Text style={styles.notice}>{block.text}</Text>;
  if (block.type === "table")
    return (
      <View>
        {block.caption ? <Text style={styles.caption}>{block.caption}</Text> : null}
        <Table columns={block.columns} rows={block.rows} />
      </View>
    );
  return (
    <View>
      {block.items.map((item) => (
        <Item key={item.key} item={item} accent={accent} />
      ))}
    </View>
  );
}

function Chrome({ model, watermark, logoData }: { model: DocModel; watermark?: string; logoData: Buffer }) {
  return (
    <>
      <View style={styles.header} fixed>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt attribute */}
        <Image src={{ data: logoData, format: "jpg" }} style={{ width: 26, height: 26 }} />
        <Text style={styles.headerText}>
          {model.meta.code} · Version {model.meta.version} · {model.meta.statusLabel}
        </Text>
      </View>
      <View style={styles.footer} fixed>
        <Text>
          {model.meta.confidentiality} · {model.meta.footer}
        </Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
      {watermark ? (
        <Text style={styles.watermark} fixed>
          {watermark}
        </Text>
      ) : null}
    </>
  );
}

function SrsPdf({ model, watermark, logoData, pages }: { model: DocModel; watermark?: string; logoData: Buffer; pages: Map<string, number> }) {
  const accent = model.meta.accent;
  const record = (id: string) => ({ pageNumber }: { pageNumber: number }) => {
    pages.set(id, pageNumber);
    return "";
  };
  return (
    <Document title={`${model.meta.code} v${model.meta.version}`} author="Elec Novatech PLC" subject="Software Requirements Specification" creator="Elec CRM">
      <Page size="A4" style={styles.cover}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt attribute */}
        <Image src={{ data: logoData, format: "jpg" }} style={{ width: 140, height: 140, marginBottom: 28 }} />
        <Text style={{ fontSize: 9, color: accent, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Software Requirements Specification</Text>
        <Text style={{ fontSize: 22, fontFamily: "Helvetica-Bold", marginBottom: 6 }}>{model.meta.projectName}</Text>
        <Text style={{ fontSize: 11, color: muted, marginBottom: 28 }}>{model.meta.projectType}</Text>
        <Table
          columns={["Field", "Value"]}
          rows={[
            ["Document ID", model.meta.code],
            ["Version", model.meta.version],
            ["Status", model.meta.statusLabel],
            ["Prepared by", model.meta.preparedBy],
            ["Prepared for", model.meta.preparedFor],
            ["Created", model.meta.createdOn],
            ["Generated", model.meta.updatedOn],
            ["Template", model.meta.template],
            ["Classification", model.meta.confidentiality],
          ]}
        />
        {watermark ? <Text style={{ marginTop: 16, color: "#b3261e", fontFamily: "Helvetica-Bold" }}>{watermark} — this copy is not the approved baseline.</Text> : null}
        <Text style={{ position: "absolute", bottom: 40, left: 60, right: 60, fontSize: 7.5, color: muted }}>
          {model.meta.confidentiality}. Prepared by Elec Novatech PLC for {model.meta.preparedFor}. Do not distribute outside the named organizations.
        </Text>
      </Page>

      <Page size="A4" style={styles.page}>
        <Chrome model={model} watermark={watermark} logoData={logoData} />
        <View style={styles.body}>
        <Text style={styles.h1}>Document control</Text>
        <Text style={styles.caption}>Revision history</Text>
        <Table columns={["Version", "Date", "Author", "Status", "Notes"]} rows={model.revisions.length ? model.revisions.map((r) => [r.version, r.date, r.author, r.status, r.note]) : [[model.meta.version, model.meta.updatedOn, "—", model.meta.statusLabel, "Working draft"]]} />
        <Text style={styles.caption}>Approvals</Text>
        <Table
          columns={["Side", "Name", "Role", "Decision", "Date", "Fingerprint"]}
          rows={model.approval.signatures.length ? model.approval.signatures.map((s) => [s.side === "client" ? "Client" : "Elec Novatech", s.name, s.role, s.decision, s.date, s.hash]) : [["—", `Requires ${model.approval.clientSigners} client and ${model.approval.companySigners} Elec Novatech approval(s)`, "", "Pending", "", ""]]}
        />
        <Text style={[styles.h1, { marginTop: 22 }]}>Contents</Text>
        {model.groups.map((group) => (
          <View key={group.number}>
            <View style={styles.toc}>
              <Text style={{ width: 28, fontFamily: "Helvetica-Bold" }}>{group.number}</Text>
              <Text style={{ flex: 1, fontFamily: "Helvetica-Bold" }}>{group.title}</Text>
              <Text style={{ width: 30, textAlign: "right" }}>{pages.get(`g${group.number}`) ?? ""}</Text>
            </View>
            {group.sections.map((section) => (
              <View key={section.number} style={styles.toc}>
                <Text style={{ width: 28, paddingLeft: 10, color: muted }} />
                <Text style={{ width: 34, color: muted }}>{section.number}</Text>
                <Text style={{ flex: 1 }}>{section.title}</Text>
                <Text style={{ width: 30, textAlign: "right", color: muted }}>{pages.get(`s${section.number}`) ?? ""}</Text>
              </View>
            ))}
          </View>
        ))}
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Chrome model={model} watermark={watermark} logoData={logoData} />
        <View style={styles.body}>
        {model.groups.map((group) => (
          <View key={group.number}>
            <Text style={[styles.h1, { color: accent }]} minPresenceAhead={120}>
              {group.number}  {group.title}
              <Text render={record(`g${group.number}`)} />
            </Text>
            {group.sections.map((section) => (
              <View key={section.number}>
                <Text style={styles.h2} minPresenceAhead={70}>
                  {section.number}  {section.title}
                  <Text render={record(`s${section.number}`)} />
                </Text>
                {section.notApplicable ? <Text style={styles.notice}>Not applicable: {section.notApplicable}</Text> : section.blocks.map((block, index) => <Block key={index} block={block} accent={accent} />)}
              </View>
            ))}
          </View>
        ))}
        </View>
      </Page>
    </Document>
  );
}

export async function renderPdf(model: DocModel, watermark?: string) {
  const logoData = await logoBytes();
  const pages = new Map<string, number>();
  await renderToBuffer(<SrsPdf model={model} watermark={watermark} logoData={logoData} pages={pages} />);
  return renderToBuffer(<SrsPdf model={model} watermark={watermark} logoData={logoData} pages={pages} />);
}
