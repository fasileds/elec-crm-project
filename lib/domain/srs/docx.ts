import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { ORIGIN_LABELS, PRIORITY_LABELS, QA_LABELS, type Origin } from "@/lib/domain/srs/catalog";
import type { DocBlock, DocItem, DocModel } from "@/lib/domain/srs/model";

const MUTED = "5B6372";
const border = { style: BorderStyle.SINGLE, size: 4, color: "D9DDE4" };

function paragraphs(text: string) {
  return text.split(/\n{2,}/).map((para) => new Paragraph({ spacing: { after: 120 }, children: para.split("\n").flatMap((line, i) => (i ? [new TextRun({ break: 1, text: line })] : [new TextRun(line)])) }));
}

function caption(text: string) {
  return new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: text.toUpperCase(), size: 15, color: MUTED })] });
}

function table(columns: string[], rows: string[][]) {
  const cell = (text: string, head = false) =>
    new TableCell({
      borders: { top: border, bottom: border, left: border, right: border },
      shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F5F8" } : undefined,
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: head, size: head ? 17 : 18 })] })],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c) => cell(c, true)) }), ...rows.map((row) => new TableRow({ cantSplit: true, children: row.map((c) => cell(c)) }))],
  });
}

function item(entry: DocItem) {
  const out: Array<Paragraph | Table> = [
    new Paragraph({ keepNext: true, spacing: { before: 160, after: 40 }, children: [new TextRun({ text: `${entry.key}  `, bold: true }), new TextRun({ text: entry.title, bold: true })] }),
    new Paragraph({ keepNext: true, spacing: { after: 60 }, children: [new TextRun({ text: [PRIORITY_LABELS[entry.priority] ?? entry.priority, entry.status.replaceAll("_", " "), ORIGIN_LABELS[entry.origin as Origin] ?? entry.origin].join("  ·  "), size: 16, color: MUTED })] }),
  ];
  if (entry.description) out.push(...paragraphs(entry.description));
  if (entry.fields.length) out.push(table(["Field", "Value"], entry.fields.map(([k, v]) => [k, v])));
  if (entry.steps?.length) {
    out.push(caption("Workflow"));
    out.push(table(["#", "Type", "Actor", "Action", "Input", "Output", "Exception / branch"], entry.steps.map((s) => [s.id, s.type === "decision" ? "Decision" : "Step", s.actor, s.action, s.input, s.output, [s.exception, s.type === "decision" && s.yes ? `Yes: ${s.yes}` : "", s.type === "decision" && s.no ? `No: ${s.no}` : ""].filter(Boolean).join("; ")])));
  }
  if (entry.criteria.length) {
    out.push(caption("Acceptance criteria"));
    out.push(table(["#", "Given", "When", "Then", "QA"], entry.criteria.map((c, i) => [`AC${i + 1}`, c.given, c.when, c.then, QA_LABELS[c.qa] ?? c.qa])));
  }
  return out;
}

function block(entry: DocBlock): Array<Paragraph | Table> {
  if (entry.type === "text") return [...(entry.caption ? [caption(entry.caption)] : []), ...paragraphs(entry.text)];
  if (entry.type === "notice") return [new Paragraph({ shading: { type: ShadingType.CLEAR, color: "auto", fill: "F3F5F8" }, spacing: { after: 120 }, children: [new TextRun({ text: entry.text, color: MUTED, size: 17 })] })];
  if (entry.type === "table") return [...(entry.caption ? [caption(entry.caption)] : []), table(entry.columns, entry.rows), new Paragraph("")];
  return entry.items.flatMap(item);
}

export async function renderDocx(model: DocModel, watermark?: string) {
  const logo = await readFile(path.join(process.cwd(), "public", "brand", "logo.jpg"));
  const accent = model.meta.accent.replace("#", "");
  const header = new Header({
    children: [
      new Paragraph({
        children: [
          new ImageRun({ type: "jpg", data: logo, transformation: { width: 28, height: 28 } }),
          new TextRun({ text: `   ${model.meta.code} · Version ${model.meta.version} · ${model.meta.statusLabel}`, size: 15, color: MUTED }),
          ...(watermark ? [new TextRun({ text: `   ${watermark}`, bold: true, size: 16, color: "C62828" })] : []),
        ],
      }),
    ],
  });
  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: `${model.meta.confidentiality} · ${model.meta.footer}    Page `, size: 15, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], size: 15, color: MUTED }), new TextRun({ text: " of ", size: 15, color: MUTED }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, color: MUTED })],
      }),
    ],
  });
  const body: Array<Paragraph | Table | TableOfContents> = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Document control")] }),
    caption("Revision history"),
    table(["Version", "Date", "Author", "Status", "Notes"], model.revisions.length ? model.revisions.map((r) => [r.version, r.date, r.author, r.status, r.note]) : [[model.meta.version, model.meta.updatedOn, "—", model.meta.statusLabel, "Working draft"]]),
    caption("Approvals"),
    table(["Side", "Name", "Role", "Decision", "Date", "Fingerprint"], model.approval.signatures.length ? model.approval.signatures.map((s) => [s.side === "client" ? "Client" : "Elec Novatech", s.name, s.role, s.decision, s.date, s.hash]) : [["—", `Requires ${model.approval.clientSigners} client and ${model.approval.companySigners} Elec Novatech approval(s)`, "", "Pending", "", ""]]),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Contents")] }),
    new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }),
    ...model.groups.flatMap((g) => [new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `${g.number}  ${g.title}`, bold: true, size: 18 })] }), ...g.sections.map((s) => new Paragraph({ indent: { left: 360 }, spacing: { after: 10 }, children: [new TextRun({ text: `${s.number}  ${s.title}`, size: 17, color: MUTED })] }))]),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  for (const group of model.groups) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, keepNext: true, children: [new TextRun({ text: `${group.number}  ${group.title}`, color: accent })] }));
    for (const section of group.sections) {
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, children: [new TextRun(`${section.number}  ${section.title}`)] }));
      if (section.notApplicable) body.push(...block({ type: "notice", text: `Not applicable: ${section.notApplicable}` }));
      else for (const entry of section.blocks) body.push(...block(entry));
    }
  }
  const document = new Document({
    creator: "Elec Novatech PLC",
    title: `${model.meta.code} v${model.meta.version}`,
    description: "Software Requirements Specification",
    features: { updateFields: true },
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [
      {
        children: [
          new Paragraph({ children: [new ImageRun({ type: "jpg", data: logo, transformation: { width: 150, height: 150 } })] }),
          new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: "SOFTWARE REQUIREMENTS SPECIFICATION", color: accent, size: 18 })] }),
          new Paragraph({ children: [new TextRun({ text: model.meta.projectName, bold: true, size: 44 })] }),
          new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: model.meta.projectType, color: MUTED, size: 22 })] }),
          table(["Field", "Value"], [
            ["Document ID", model.meta.code],
            ["Version", model.meta.version],
            ["Status", model.meta.statusLabel],
            ["Prepared by", model.meta.preparedBy],
            ["Prepared for", model.meta.preparedFor],
            ["Created", model.meta.createdOn],
            ["Generated", model.meta.updatedOn],
            ["Template", model.meta.template],
            ["Classification", model.meta.confidentiality],
          ]),
          ...(watermark ? [new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: `${watermark} — this copy is not the approved baseline.`, bold: true, color: "C62828" })] })] : []),
        ],
      },
      { headers: { default: header }, footers: { default: footer }, children: body },
    ],
  });
  return Packer.toBuffer(document);
}
