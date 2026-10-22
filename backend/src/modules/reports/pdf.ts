import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import { byCategory, summary, topProducts } from "./service.js";

// The built-in PDF font has no ₹ glyph, so the PDF writes "Rs." instead.
const rupees = (paise: number) => `Rs. ${(paise / 100).toFixed(2)}`;

// Daily sales and profit report. Uses the same functions as the dashboard, so the numbers
// in the PDF and on the screen cannot differ.
export async function writeDailyReport(date: string, out: Writable) {
  const range = { from: date, to: date };
  const [totals, categories, products] = await Promise.all([summary(range), byCategory(range), topProducts(range, 50)]);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(out);

  doc.fontSize(20).text("Snack Kiosk: daily sales report");
  doc.fontSize(11).fillColor("#555").text(`Date: ${date} (Asia/Kolkata)`).fillColor("#000").moveDown();

  section(doc, "Totals");
  table(doc, [180, 150], [
    ["Revenue", rupees(totals.revenuePaise)],
    ["Cost of goods", rupees(totals.costPaise)],
    ["Profit", rupees(totals.profitPaise)],
    ["Orders", String(totals.orders)],
    ["Units sold", String(totals.units)],
    ["Cash collected", rupees(totals.cashCollectedPaise)],
  ]);

  section(doc, "By category");
  table(doc, [180, 80, 120], [["Category", "Units", "Revenue"], ...categories.map((c) => [c.category, String(c.units), rupees(c.revenuePaise)])], true);

  section(doc, "By product");
  table(
    doc,
    [180, 60, 110, 110],
    [["Product", "Units", "Revenue", "Profit"], ...products.map((p) => [p.name, String(p.units), rupees(p.revenuePaise), rupees(p.profitPaise)])],
    true,
  );

  section(doc, "Cash collected by staff");
  table(
    doc,
    [220, 80, 120],
    [["Staff", "Approvals", "Amount"], ...totals.cashByOperator.map((c) => [c.email, String(c.approvals), rupees(c.amountPaise)])],
    true,
  );

  doc.end();
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown().fontSize(14).text(title, 50).moveDown(0.3).fontSize(10);
}

// Rows of text in fixed-width columns. The first row is bold when it is a header.
function table(doc: PDFKit.PDFDocument, widths: number[], rows: string[][], header = false) {
  if (rows.length === (header ? 1 : 0)) {
    doc.text("No data.", 50);
    return;
  }
  rows.forEach((row, index) => {
    const y = doc.y;
    let x = 50;
    doc.font(header && index === 0 ? "Helvetica-Bold" : "Helvetica");
    row.forEach((cell, i) => {
      doc.text(cell, x, y, { width: widths[i] - 8 });
      x += widths[i];
    });
    doc.moveDown(0.2);
  });
  doc.font("Helvetica");
}
