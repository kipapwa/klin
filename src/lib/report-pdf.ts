import { pdfSafe, type ReportDoc } from "./report.ts";

/**
 * Desenha o relatório em PDF (A4) com o jsPDF, carregado só quando o
 * usuário pede o relatório (não pesa na abertura do app).
 */
export async function renderReportPdf(doc: ReportDoc): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setProperties({ title: `${pdfSafe(doc.title)} - Klin`, creator: "Klin" });

  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 18;
  const width = W - 2 * M;
  const bottom = H - 20;
  let y = M;

  const ensure = (needed: number) => {
    if (y + needed > bottom) {
      pdf.addPage();
      y = M;
    }
  };

  const write = (text: string, size: number, opts: { bold?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(...(opts.color ?? [24, 24, 27]));
    const lineH = size * 0.42;
    for (const line of pdf.splitTextToSize(pdfSafe(text), width) as string[]) {
      ensure(lineH);
      pdf.text(line, M, y + lineH * 0.8);
      y += lineH;
    }
    y += opts.gap ?? 0;
  };

  write(doc.title, 18, { bold: true, color: [15, 118, 110], gap: 2 });
  for (const line of doc.meta) {
    write(line, 9, { color: line.startsWith("ATENÇÃO") ? [185, 28, 28] : [82, 82, 91], bold: line.startsWith("ATENÇÃO") });
  }
  y += 4;

  for (const section of doc.sections) {
    ensure(14);
    pdf.setDrawColor(...((section.alert ? [220, 38, 38] : [212, 212, 216]) as [number, number, number]));
    pdf.setLineWidth(section.alert ? 0.8 : 0.3);
    pdf.line(M, y, W - M, y);
    y += 3;
    write(section.heading, 11, { bold: true, color: section.alert ? [153, 27, 27] : [24, 24, 27], gap: 1.5 });
    for (const block of section.blocks) {
      if (block.label) write(block.label, 8.5, { bold: true, color: [113, 113, 122] });
      write(block.text, 10, { gap: 2 });
    }
    y += 3;
  }

  // Rodapé com numeração em todas as páginas.
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(113, 113, 122);
    const footer = pdf.splitTextToSize(pdfSafe(doc.footer), width - 25) as string[];
    pdf.text(footer, M, H - 12);
    pdf.text(`${i}/${pages}`, W - M, H - 12, { align: "right" });
  }

  return pdf.output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
