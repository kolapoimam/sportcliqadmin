import type { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { createPdf } from './pdf'

// Brand colours as RGB for jsPDF. Flat colours only.
const GREEN: [number, number, number] = [53, 181, 81]
const DARK_GREEN: [number, number, number] = [5, 150, 79]
const INK: [number, number, number] = [14, 20, 17]
const MUTED: [number, number, number] = [107, 114, 128]
const LINE: [number, number, number] = [229, 231, 235]
const SOFT: [number, number, number] = [243, 247, 244]

async function imageData(url: string) {
  const blob = await (await fetch(url)).blob()
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

async function brandAssets() {
  const [logo, mark] = await Promise.all([
    imageData('/brand/sportcliq-logo.png').catch(() => null),
    imageData('/brand/sportcliq-mark.png').catch(() => null),
  ])
  return { logo, mark }
}

const fontOf = (doc: jsPDF) => doc.getFont().fontName

function header(doc: jsPDF, logo: string | null, title: string, subtitle?: string) {
  const w = doc.internal.pageSize.getWidth()
  const font = fontOf(doc)
  doc.setFillColor(...GREEN)
  doc.rect(0, 0, w, 3, 'F')
  if (logo) doc.addImage(logo, 'PNG', 14, 9, 30, 12)
  doc.setFont(font, 'bold'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('ADMIN REPORT', w - 14, 13, { align: 'right' })
  doc.setFont(font, 'normal')
  doc.text(new Date().toLocaleString(), w - 14, 18, { align: 'right' })
  doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(14, 26, w - 14, 26)
  doc.setFont(font, 'bold'); doc.setFontSize(18); doc.setTextColor(...INK)
  doc.text(title, 14, 37)
  let y = 37
  if (subtitle) {
    doc.setFont(font, 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED)
    const lines = doc.splitTextToSize(subtitle, w - 28)
    doc.text(lines, 14, 44)
    y = 44 + (lines.length - 1) * 5
  }
  return y + 8
}

function footers(doc: jsPDF, note: string) {
  const pages = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const font = fontOf(doc)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(14, h - 14, w - 14, h - 14)
    doc.setFont(font, 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(note, 14, h - 8)
    doc.text(`Page ${i} of ${pages}`, w - 14, h - 8, { align: 'right' })
  }
}

export type ReportTable = { title: string; head: string[]; rows: (string | number)[][]; alignRight?: number[]; foot?: (string | number)[] }
export type ReportSection = ReportTable | { title: string; image: string; height?: number } | { title: string; text: string }

export async function brandedReport(opts: {
  title: string
  subtitle?: string
  filters?: [string, string][]
  kpis?: { label: string; value: string }[]
  sections: ReportSection[]
  generatedBy?: string
  fileName: string
  landscape?: boolean
}) {
  const doc = await createPdf()
  if (opts.landscape) {
    doc.deletePage(1)
    doc.addPage('a4', 'landscape')
  }
  const font = fontOf(doc)
  const { logo } = await brandAssets()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  let y = header(doc, logo, opts.title, opts.subtitle)

  const ensure = (need: number) => {
    if (y + need > h - 22) { doc.addPage(); y = header(doc, logo, opts.title) }
  }

  if (opts.filters?.length) {
    doc.setFontSize(8.5)
    let x = 14
    for (const [k, v] of opts.filters) {
      const label = `${k}  ${v}`
      const tw = doc.getTextWidth(label) + 8
      if (x + tw > w - 14) { x = 14; y += 9 }
      doc.setFillColor(...SOFT); doc.roundedRect(x, y - 5, tw, 7.5, 3.5, 3.5, 'F')
      doc.setFont(font, 'bold'); doc.setTextColor(...MUTED); doc.text(k, x + 4, y)
      doc.setFont(font, 'normal'); doc.setTextColor(...INK); doc.text(v, x + 4 + doc.getTextWidth(k + '  '), y)
      x += tw + 3
    }
    y += 10
  }

  if (opts.kpis?.length) {
    const cols = Math.min(opts.kpis.length, opts.landscape ? 5 : 4)
    const gap = 4
    const cw = (w - 28 - gap * (cols - 1)) / cols
    opts.kpis.forEach((k, i) => {
      const col = i % cols
      if (col === 0 && i > 0) y += 26
      if (col === 0) ensure(24)
      const x = 14 + col * (cw + gap)
      doc.setFillColor(...SOFT); doc.roundedRect(x, y, cw, 22, 3, 3, 'F')
      doc.setFillColor(...GREEN); doc.rect(x, y + 4, 1.2, 14, 'F')
      doc.setFont(font, 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
      doc.text(k.label, x + 5, y + 8)
      doc.setFont(font, 'bold'); doc.setFontSize(13); doc.setTextColor(...INK)
      doc.text(doc.splitTextToSize(k.value, cw - 8)[0], x + 5, y + 16.5)
    })
    y += 32
  }

  for (const s of opts.sections) {
    ensure(24)
    doc.setFont(font, 'bold'); doc.setFontSize(12); doc.setTextColor(...INK)
    doc.text(s.title, 14, y)
    y += 4
    if ('image' in s) {
      const ih = s.height ?? 70
      ensure(ih + 4)
      doc.addImage(s.image, 'PNG', 14, y, w - 28, ih)
      y += ih + 10
    } else if ('text' in s) {
      doc.setFont(font, 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED)
      const lines = doc.splitTextToSize(s.text, w - 28)
      doc.text(lines, 14, y + 5)
      y += lines.length * 5 + 10
    } else {
      const right = Object.fromEntries((s.alignRight ?? []).map((i) => [i, { halign: 'right' as const }]))
      autoTable(doc, {
        startY: y + 1,
        head: [s.head],
        body: s.rows.length ? s.rows.map((r) => r.map((c) => String(c))) : [[{ content: 'No data for these filters', colSpan: s.head.length, styles: { halign: 'center', textColor: MUTED } }]],
        foot: s.foot ? [s.foot.map((c) => String(c))] : undefined,
        margin: { left: 14, right: 14, top: 48, bottom: 20 },
        styles: { font, fontSize: 8.5, cellPadding: 2.4, textColor: INK, lineColor: LINE, lineWidth: 0 },
        headStyles: { font, fontStyle: 'bold', fillColor: INK, textColor: [255, 255, 255] },
        footStyles: { font, fontStyle: 'bold', fillColor: SOFT, textColor: INK },
        alternateRowStyles: { fillColor: [250, 251, 250] },
        columnStyles: right,
        didParseCell: (d) => { if ((s.alignRight ?? []).includes(d.column.index)) d.cell.styles.halign = 'right' },
        willDrawPage: (d) => { if (d.pageNumber > 1) header(doc, logo, opts.title) },
      })
      y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 12
    }
  }

  footers(doc, `SportCliq Admin  ·  Confidential${opts.generatedBy ? `  ·  Generated by ${opts.generatedBy}` : ''}`)
  doc.save(opts.fileName)
}

/** Payout receipt for a cashout or an ambassador payout that was marked paid. */
export async function payoutReceipt(r: {
  reference: string
  kind: string
  payee: string
  bank?: string | null
  account?: string | null
  amount: number
  method?: string | null
  approvedBy?: string | null
  paidAt?: string | null
  requestedAt?: string | null
  note?: string | null
  id: string
}) {
  const doc = await createPdf()
  const font = fontOf(doc)
  const { logo, mark } = await brandAssets()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()

  doc.setFillColor(...GREEN); doc.rect(0, 0, w, 3, 'F')
  if (logo) doc.addImage(logo, 'PNG', 14, 12, 35, 14)
  doc.setFont(font, 'bold'); doc.setFontSize(9); doc.setTextColor(...MUTED)
  doc.text('PAYOUT RECEIPT', w - 14, 17, { align: 'right' })
  doc.setFont(font, 'normal')
  doc.text(`Receipt ${r.reference || r.id.slice(0, 8).toUpperCase()}`, w - 14, 23, { align: 'right' })

  // Amount block
  doc.setFillColor(...SOFT); doc.roundedRect(14, 38, w - 28, 42, 4, 4, 'F')
  doc.setFont(font, 'normal'); doc.setFontSize(10); doc.setTextColor(...MUTED)
  doc.text('Amount paid', 22, 51)
  doc.setFont(font, 'bold'); doc.setFontSize(28); doc.setTextColor(...INK)
  doc.text(`₦${Number(r.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 22, 66)
  doc.setFillColor(...DARK_GREEN); doc.roundedRect(w - 14 - 34, 46, 26, 9, 4.5, 4.5, 'F')
  doc.setFont(font, 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255)
  doc.text('PAID', w - 14 - 21, 51.8, { align: 'center' })
  doc.setFont(font, 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED)
  doc.text(r.paidAt ? new Date(r.paidAt).toLocaleString() : new Date().toLocaleString(), 22, 74)

  const rows: [string, string][] = [
    ['Paid to', r.payee || '-'],
    ['Payout type', r.kind],
    ['Bank', r.bank || '-'],
    ['Account number', r.account || '-'],
    ['Transfer reference', r.reference || '-'],
    ['Payment method', r.method || 'Manual bank transfer'],
    ['Requested on', r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '-'],
    ['Approved by', r.approvedBy || '-'],
    ['Record ID', r.id],
  ]
  autoTable(doc, {
    startY: 90,
    body: rows,
    theme: 'plain',
    margin: { left: 14, right: 14 },
    styles: { font, fontSize: 10, cellPadding: { top: 3.2, bottom: 3.2, left: 0, right: 0 }, textColor: INK },
    columnStyles: { 0: { textColor: MUTED, cellWidth: 60 }, 1: { fontStyle: 'bold', halign: 'right' } },
    didDrawCell: (d) => { if (d.section === 'body' && d.column.index === 1) { doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(14, d.cell.y + d.cell.height, w - 14, d.cell.y + d.cell.height) } },
  })
  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180) + 12
  if (r.note) {
    doc.setFont(font, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED)
    const lines = doc.splitTextToSize(r.note, w - 28)
    doc.text(lines, 14, y)
    y += lines.length * 5 + 6
  }
  doc.setFont(font, 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED)
  doc.text(doc.splitTextToSize('This receipt confirms that SportCliq recorded this payout as paid by manual bank transfer. Keep it for your records. For questions write to sportcliqapp@gmail.com.', w - 28), 14, y)

  if (mark) doc.addImage(mark, 'PNG', 14, h - 26, 9, 9)
  doc.setFont(font, 'bold'); doc.setFontSize(9); doc.setTextColor(...INK)
  doc.text('SportCliq', 26, h - 20)
  doc.setFont(font, 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
  doc.text('sportcliq.com', 26, h - 16)
  doc.text(`Generated ${new Date().toLocaleString()}`, w - 14, h - 16, { align: 'right' })
  doc.setFillColor(...GREEN); doc.rect(0, h - 3, w, 3, 'F')

  doc.save(`sportcliq-receipt-${(r.reference || r.id.slice(0, 8)).replace(/[^a-zA-Z0-9-]/g, '')}.pdf`)
}
