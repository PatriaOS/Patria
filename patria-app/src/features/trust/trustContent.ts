export type TrustInline = {
  text: string;
  bold?: boolean;
};

export type TrustBlock =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'lede'; spans: TrustInline[] }
  | { type: 'p'; spans: TrustInline[] }
  | { type: 'ul'; items: TrustInline[][] };

export type TrustDocument = {
  id: 'how-patria-protects' | 'privacy-statement';
  sourceFile: string;
  blocks: TrustBlock[];
};

/** Parse inline **bold** markers into spans. */
export function parseInline(raw: string): TrustInline[] {
  const spans: TrustInline[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    if (match.index > last) {
      spans.push({ text: raw.slice(last, match.index) });
    }
    spans.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < raw.length) {
    spans.push({ text: raw.slice(last) });
  }
  return spans.length > 0 ? spans : [{ text: raw }];
}

function stripOuterItalics(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') && trimmed.endsWith('*') && !trimmed.startsWith('**')) {
    return trimmed.slice(1, -1);
  }
  return null;
}

/** Convert a trust markdown document into typed blocks (no HTML). */
export function parseTrustMarkdown(markdown: string): TrustBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: TrustBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', text: trimmed.slice(4).trim() });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', text: trimmed.slice(3).trim() });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', text: trimmed.slice(2).trim() });
      i += 1;
      continue;
    }

    const italic = stripOuterItalics(trimmed);
    if (italic !== null && !trimmed.startsWith('- ') && !trimmed.startsWith('* ')) {
      blocks.push({ type: 'lede', spans: parseInline(italic) });
      i += 1;
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const items: TrustInline[][] = [];
      while (i < lines.length) {
        const bullet = (lines[i] ?? '').trim();
        if (!bullet.startsWith('- ')) {
          break;
        }
        items.push(parseInline(bullet.slice(2)));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    const para: string[] = [trimmed];
    i += 1;
    while (i < lines.length) {
      const next = (lines[i] ?? '').trim();
      if (
        next.length === 0 ||
        next.startsWith('#') ||
        next.startsWith('- ') ||
        stripOuterItalics(next) !== null
      ) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ type: 'p', spans: parseInline(para.join(' ')) });
  }

  return blocks;
}
