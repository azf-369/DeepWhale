/**
 * Lightweight, XSS-safe, streaming-friendly Markdown to HTML renderer.
 * Supports unclosed fenced code blocks during live SSE streaming + 1-click code copy.
 */

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInline(escaped) {
  return escaped
    // Inline code
    .replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>')
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    // Links [text](https://...)
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" class="md-link" data-ext-url="$2">$1</a>'
    );
}

export function renderMarkdown(raw) {
  if (!raw) return '';
  const normalized = String(raw).replace(/\r\n/g, '\n');

  // Split by fenced code blocks (even if trailing ``` hasn't arrived yet)
  const segments = [];
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match;

  while ((match = fenceRegex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'prose', text: normalized.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      lang: (match[1] || 'code').trim(),
      code: match[2] || ''
    });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) break;
  }
  if (lastIndex < normalized.length) {
    segments.push({ type: 'prose', text: normalized.slice(lastIndex) });
  }

  return segments
    .map((seg) => {
      if (seg.type === 'code') {
        const escapedCode = escapeHtml(seg.code.replace(/\n$/, ''));
        const encodedAttr = encodeURIComponent(seg.code.replace(/\n$/, ''));
        return `
          <div class="md-code-block">
            <div class="md-code-header">
              <span class="md-code-lang">${escapeHtml(seg.lang)}</span>
              <button type="button" class="md-copy-btn" data-copy-code="${encodedAttr}">复制</button>
            </div>
            <pre><code>${escapedCode}</code></pre>
          </div>
        `;
      }

      const lines = seg.text.split('\n');
      const htmlOut = [];
      let inList = false;

      const closeList = () => {
        if (inList) {
          htmlOut.push('</ul>');
          inList = false;
        }
      };

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
          closeList();
          continue;
        }

        const escaped = escapeHtml(line);

        // Headings
        const hMatch = escaped.match(/^(#{1,4})\s+(.+)$/);
        if (hMatch) {
          closeList();
          const lvl = hMatch[1].length;
          htmlOut.push(`<h${lvl} class="md-h${lvl}">${formatInline(hMatch[2])}</h${lvl}>`);
          continue;
        }

        // Blockquote
        if (escaped.startsWith('&gt; ')) {
          closeList();
          htmlOut.push(`<blockquote class="md-quote">${formatInline(escaped.slice(5))}</blockquote>`);
          continue;
        }

        // Unordered or ordered list item
        const ulMatch = escaped.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
        if (ulMatch) {
          if (!inList) {
            htmlOut.push('<ul class="md-list">');
            inList = true;
          }
          htmlOut.push(`<li>${formatInline(ulMatch[1])}</li>`);
          continue;
        }

        closeList();
        htmlOut.push(`<p class="md-p">${formatInline(escaped)}</p>`);
      }

      closeList();
      return htmlOut.join('');
    })
    .join('');
}

export function stripMarkdownPreview(raw, maxLen = 110) {
  const plain = String(raw || '')
    .replace(/```[\s\S]*?(?:```|$)/g, ' [代码片段] ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen)}…`;
}
