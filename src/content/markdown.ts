/** 아주 작은 마크다운 → HTML 변환기 (외부 의존성 없이 대시보드 미리보기·복사용) */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return out;
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') {
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^[•\-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line.trim());
    if (ordered) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(ordered[2])}</li>`);
      continue;
    }
    if (/^>\s?/.test(line.trim())) {
      closeList();
      html.push(`<blockquote>${inline(line.trim().replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeList();
      html.push('<hr />');
      continue;
    }
    closeList();
    html.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();
  return html.join('\n');
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replace(/^[•\-*]\s+/gm, '· ')
    .trim();
}
