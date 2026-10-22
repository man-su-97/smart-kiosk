import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";
import PDFDocument from "pdfkit";
import { config } from "../../config.js";
import { bills, summary, topProducts, type Bill } from "./service.js";

// Daily sales register: one row per bill, like a printed bill book, plus totals and summaries.
// Uses the same functions as the dashboard, so the numbers cannot differ.

// DejaVu Sans has the ₹ sign (PDF's built-in fonts do not). Bundled in backend/assets/fonts.
const FONT = fileURLToPath(new URL("../../../assets/fonts/DejaVuSans.ttf", import.meta.url));
const FONT_BOLD = fileURLToPath(new URL("../../../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));

const INK = "#1f2140";
const MUTED = "#6b6f8a";
const BRAND = "#ff6a3d";
const ZEBRA = "#f4f5fb";
const LINE = "#d9dbe9";

const MARGIN = 36;
const FOOTER_SPACE = 30;

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
const longDate = (isoDay: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${isoDay}T00:00:00Z`),
  );

type Column = { label: string; width: number; align?: "left" | "right" | "center" };
type Doc = PDFKit.PDFDocument;

export async function writeDailyReport(date: string, out: Writable) {
  const range = { from: date, to: date };
  const [totals, rows, products] = await Promise.all([summary(range), bills(range), topProducts(range, 100)]);

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGIN, bufferPages: true });
  doc.registerFont("regular", FONT).registerFont("bold", FONT_BOLD).font("regular");
  doc.info.Title = `Daily Sales Register ${date}`;
  doc.pipe(out);

  const width = doc.page.width - MARGIN * 2;
  const generated = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: config.reportTimeZone,
  }).format(new Date());

  header(doc, width, longDate(date), generated, rows.some((b) => b.demo));
  cards(doc, width, [
    ["Gross sales", money(totals.revenuePaise)],
    ["Bills", String(rows.length)],
    ["Units sold", String(totals.units)],
    ["UPI", money(sum(rows.filter((b) => b.paymentMode === "UPI")))],
    ["Cash", money(sum(rows.filter((b) => b.paymentMode === "Cash")))],
    ["Gross profit", money(totals.profitPaise)],
  ]);

  // ---- The register: one line per bill --------------------------------------
  heading(doc, "Bills");
  const billColumns: Column[] = [
    { label: "#", width: 24, align: "right" },
    { label: "Bill no.", width: 70 },
    { label: "Date", width: 66 },
    { label: "Time", width: 54 },
    { label: "Kiosk", width: 76 },
    { label: "Items", width: 216 },
    { label: "Qty", width: 30, align: "right" },
    { label: "Mode", width: 42 },
    { label: "Agent / collector", width: 112 },
    { label: "Amount", width: 80, align: "right" },
  ];
  table(
    doc,
    billColumns,
    rows.map((b, i) => [
      String(i + 1), b.billNo, b.date, b.time, b.kioskCode, b.items,
      String(b.quantity), b.paymentMode, b.staff, money(b.amountPaise),
    ]),
    ["", "", "", "", "", "Total", String(rows.reduce((n, b) => n + b.quantity, 0)), "", "", money(sum(rows))],
    "No bills on this day.",
  );

  // ---- Summaries ------------------------------------------------------------
  const third = (width - 2 * 16) / 3;
  const summaryRows = Math.max(new Set(rows.map((b) => b.paymentMode)).size, new Set(rows.map((b) => b.kioskCode)).size, new Set(rows.map((b) => b.staff)).size, 1);
  ensureSpace(doc, 40 + (summaryRows + 1) * 24); // heading and tables stay together
  heading(doc, "By payment mode, kiosk and staff");
  sideBySide(doc, [
    {
      columns: [{ label: "Mode", width: third - 150 }, { label: "Bills", width: 50, align: "right" }, { label: "Amount", width: 100, align: "right" }],
      rows: group(rows, (b) => b.paymentMode),
    },
    {
      columns: [{ label: "Kiosk", width: third - 150 }, { label: "Bills", width: 50, align: "right" }, { label: "Amount", width: 100, align: "right" }],
      rows: group(rows, (b) => (b.kioskName ? `${b.kioskCode}\n${b.kioskName}` : b.kioskCode)),
    },
    {
      // Cash column = what each person should hand over at the end of the day.
      columns: [
        { label: "Agent / collector", width: third - 170 },
        { label: "Bills", width: 40, align: "right" },
        { label: "Cash", width: 65, align: "right" },
        { label: "Total", width: 65, align: "right" },
      ],
      rows: group(rows, (b) => b.staff).map(([name, count, total]) => [
        name,
        count,
        money(sum(rows.filter((b) => b.staff === name && b.paymentMode === "Cash"))),
        total,
      ]),
    },
  ]);

  heading(doc, "By product");
  table(
    doc,
    [
      { label: "Product", width: 260 },
      { label: "Category", width: 150 },
      { label: "Units", width: 90, align: "right" },
      { label: "Revenue", width: 135, align: "right" },
      { label: "Gross profit", width: width - 635, align: "right" },
    ],
    products.map((p) => [p.name, p.category, String(p.units), money(p.revenuePaise), money(p.profitPaise)]),
    ["Total", "", String(totals.units), money(totals.revenuePaise), money(totals.profitPaise)],
    "No products sold on this day.",
  );

  footers(doc, longDate(date));
  doc.end();
}

const sum = (rows: Bill[]) => rows.reduce((n, b) => n + b.amountPaise, 0);

// [label, bills, amount] per group, biggest amount first.
function group(rows: Bill[], key: (b: Bill) => string): string[][] {
  const totals = new Map<string, { bills: number; amount: number }>();
  for (const b of rows) {
    const entry = totals.get(key(b)) ?? { bills: 0, amount: 0 };
    entry.bills += 1;
    entry.amount += b.amountPaise;
    totals.set(key(b), entry);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([label, t]) => [label, String(t.bills), money(t.amount)]);
}

// ---- Drawing helpers ----------------------------------------------------------

function header(doc: Doc, width: number, day: string, generated: string, hasDemoData: boolean) {
  doc.rect(0, 0, doc.page.width, 78).fill(INK);
  doc.roundedRect(MARGIN, 20, 38, 38, 8).fill(BRAND);
  doc.font("bold").fontSize(15).fillColor("#ffffff").text("SK", MARGIN, 30, { width: 38, align: "center" });
  doc.font("bold").fontSize(18).text("Snack Kiosk", MARGIN + 50, 18);
  doc.font("regular").fontSize(11).fillColor("#c9cbe0").text("Daily Sales Register", MARGIN + 50, 42);

  doc.font("bold").fontSize(12).fillColor("#ffffff").text(day, MARGIN, 20, { width, align: "right" });
  doc.font("regular").fontSize(8.5).fillColor("#c9cbe0").text(`Generated ${generated} IST`, MARGIN, 38, { width, align: "right" });
  if (hasDemoData) {
    doc.font("bold").fillColor(BRAND).text("Contains sample (demo) data", MARGIN, 52, { width, align: "right" });
  }
  doc.fillColor(INK).font("regular");
  doc.y = 96;
}

function cards(doc: Doc, width: number, items: [string, string][]) {
  const gap = 10;
  const cardWidth = (width - gap * (items.length - 1)) / items.length;
  const y = doc.y;
  items.forEach(([label, value], i) => {
    const x = MARGIN + i * (cardWidth + gap);
    doc.roundedRect(x, y, cardWidth, 50, 8).fill(ZEBRA);
    doc.font("regular").fontSize(8).fillColor(MUTED).text(label, x + 10, y + 9, { width: cardWidth - 20 });
    doc.font("bold").fontSize(13).fillColor(INK).text(value, x + 10, y + 23, { width: cardWidth - 20 });
  });
  doc.font("regular");
  doc.y = y + 64;
}

function heading(doc: Doc, title: string) {
  ensureSpace(doc, 60); // never leave a heading alone at the bottom of a page
  const y = doc.y;
  doc.font("bold").fontSize(11.5).fillColor(INK).text(title, MARGIN, y);
  doc.y = y + 20;
  doc.font("regular");
}

const bottom = (doc: Doc) => doc.page.height - MARGIN - FOOTER_SPACE;

function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > bottom(doc)) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

function rowHeight(doc: Doc, columns: Column[], cells: string[], fontSize: number, font: "regular" | "bold" = "regular") {
  doc.font(font).fontSize(fontSize);
  return Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: columns[i].width - 8 }))) + 8;
}

function drawRow(doc: Doc, columns: Column[], cells: string[], y: number, height: number, style: "head" | "body" | "total", fill?: string) {
  const totalWidth = columns.reduce((n, c) => n + c.width, 0);
  if (style === "head") doc.rect(MARGIN, y, totalWidth, height).fill(INK);
  else if (fill) doc.rect(MARGIN, y, totalWidth, height).fill(fill);
  if (style === "total") doc.moveTo(MARGIN, y).lineTo(MARGIN + totalWidth, y).lineWidth(1).stroke(INK);

  doc.font(style === "body" ? "regular" : "bold").fillColor(style === "head" ? "#ffffff" : INK);
  let x = MARGIN;
  cells.forEach((cell, i) => {
    doc.text(cell, x + 4, y + 4, { width: columns[i].width - 8, align: columns[i].align ?? "left" });
    x += columns[i].width;
  });
}

// A table that continues on the next page (repeating its header) when it runs out of room.
function table(doc: Doc, columns: Column[], rows: string[][], totalRow: string[] | null, empty: string) {
  const fontSize = 8;
  const head = columns.map((c) => c.label);
  const headHeight = rowHeight(doc, columns, head, fontSize, "bold");
  // doc.text() moves doc.y, so always step from the row's own top, never from doc.y after drawing.
  const drawHead = () => {
    const y = doc.y;
    drawRow(doc, columns, head, y, headHeight, "head");
    doc.y = y + headHeight;
  };

  ensureSpace(doc, headHeight * 2);
  drawHead();
  if (rows.length === 0) {
    const y = doc.y;
    doc.font("regular").fontSize(9).fillColor(MUTED).text(empty, MARGIN + 4, y + 6);
    doc.y = y + 24;
  }
  rows.forEach((cells, i) => {
    const height = rowHeight(doc, columns, cells, fontSize);
    if (doc.y + height > bottom(doc)) {
      doc.addPage();
      doc.y = MARGIN;
      drawHead();
    }
    const y = doc.y;
    drawRow(doc, columns, cells, y, height, "body", i % 2 === 1 ? ZEBRA : undefined);
    doc.y = y + height;
  });
  if (totalRow && rows.length > 0) {
    const height = rowHeight(doc, columns, totalRow, fontSize, "bold");
    ensureSpace(doc, height);
    const y = doc.y;
    drawRow(doc, columns, totalRow, y, height, "total");
    doc.y = y + height;
  }
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + columns.reduce((n, c) => n + c.width, 0), doc.y).lineWidth(0.5).stroke(LINE);
  doc.y += 18;
}

// Small tables next to each other. They are short, so the caller makes room for them first.
function sideBySide(doc: Doc, tables: { columns: Column[]; rows: string[][] }[]) {
  const top = doc.y;
  let lowest = top;
  let x = MARGIN;
  for (const t of tables) {
    let y = top;
    withOffset(x - MARGIN, () => {
      const head = t.columns.map((c) => c.label);
      const headHeight = rowHeight(doc, t.columns, head, 8, "bold");
      drawRow(doc, t.columns, head, y, headHeight, "head");
      y += headHeight;
      if (t.rows.length === 0) {
        doc.font("regular").fontSize(9).fillColor(MUTED).text("No data.", MARGIN + 4, y + 6);
        y += 24;
      }
      t.rows.forEach((cells, i) => {
        const height = rowHeight(doc, t.columns, cells, 8);
        drawRow(doc, t.columns, cells, y, height, "body", i % 2 === 1 ? ZEBRA : undefined);
        y += height;
      });
    }, doc);
    lowest = Math.max(lowest, y);
    x += t.columns.reduce((n, c) => n + c.width, 0) + 16;
  }
  doc.y = lowest + 18;
}

// Shift drawing to the right by `dx` for the duration of `draw`.
function withOffset(dx: number, draw: () => void, doc: Doc) {
  doc.save();
  doc.translate(dx, 0);
  draw();
  doc.restore();
}

// Page footer on every page, written after all pages exist so "Page X of Y" is known.
function footers(doc: Doc, day: string) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - MARGIN - 12;
    const width = doc.page.width - MARGIN * 2;
    doc.page.margins.bottom = 0; // writing below the margin would otherwise start a new page
    doc.moveTo(MARGIN, y - 6).lineTo(MARGIN + width, y - 6).lineWidth(0.5).stroke(LINE);
    doc.font("regular").fontSize(7.5).fillColor(MUTED);
    doc.text(`Snack Kiosk · Daily Sales Register · ${day} · Amounts in ₹ (INR), times in IST`, MARGIN, y, { width, lineBreak: false });
    doc.text(`Page ${i - start + 1} of ${count}`, MARGIN, y, { width, align: "right", lineBreak: false });
  }
}
