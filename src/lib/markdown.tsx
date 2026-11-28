import * as React from 'react'

// A small, safe formatter for admin written text. It understands
// **bold**, *italic*, [links](https://...), # headings, - bullets and 1. numbered lists.
// It builds React elements, never raw HTML, so pasted text cannot inject anything.

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2]) out.push(<strong key={`${key}b${i}`}>{m[2]}</strong>)
    else if (m[3]) out.push(<em key={`${key}i${i}`}>{m[3]}</em>)
    else if (m[4]) out.push(<a key={`${key}a${i}`} href={m[5]} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">{m[4]}</a>)
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text, className }: { text?: string | null; className?: string }) {
  if (!text?.trim()) return null
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) { blocks.push(<p key={`p${blocks.length}`} className="m-0">{inline(para.join(' '), `p${blocks.length}`)}</p>); para = [] } }
  const flushList = () => {
    if (!list) return
    const L = list.ordered ? 'ol' : 'ul'
    blocks.push(<L key={`l${blocks.length}`} className={`m-0 pl-5 ${list.ordered ? 'list-decimal' : 'list-disc'}`}>{list.items.map((t, i) => <li key={i}>{inline(t, `l${blocks.length}${i}`)}</li>)}</L>)
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const h = line.match(/^#{1,3}\s+(.*)$/)
    const b = line.match(/^\s*[-*]\s+(.*)$/)
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (!line.trim()) { flushPara(); flushList(); continue }
    if (h) { flushPara(); flushList(); blocks.push(<p key={`h${blocks.length}`} className="m-0 text-base font-extrabold">{inline(h[1], `h${blocks.length}`)}</p>); continue }
    if (b || n) {
      flushPara()
      const ordered = !!n
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push((b || n)![1])
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushPara(); flushList()
  return <div className={`flex flex-col gap-2 ${className ?? ''}`}>{blocks}</div>
}
