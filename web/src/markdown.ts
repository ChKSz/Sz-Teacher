import { Marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';

/**
 * 把模型输出的 Markdown + LaTeX 渲染成安全的 HTML。
 * 先把公式提取出来用 KaTeX 渲染，避免 Markdown 把公式里的 _ * \ 当成格式符号。
 */
const marked = new Marked({ gfm: true, breaks: true });

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** 公式占位符使用私有区字符，不会和正文冲突，也不会被 Markdown 解析。 */
const MARK = '\uE000';
const CODE = '\uE001';

export function renderMarkdown(source: string): string {
  const formulas: string[] = [];
  const hold = (html: string) => `${MARK}${formulas.push(html) - 1}${MARK}`;

  // 代码块里的内容不做公式处理。
  const codeBlocks: string[] = [];
  let text = source.replace(/```[\s\S]*?(```|$)|`[^`\n]+`/g, (m) => `${CODE}${codeBlocks.push(m) - 1}${CODE}`);

  text = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => `\n\n${hold(renderMath(tex.trim(), true))}\n\n`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `\n\n${hold(renderMath(tex.trim(), true))}\n\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => hold(renderMath(tex.trim(), false)))
    // 行内 $...$：不跨行，开头和结尾不是空格（避免把"5$ 和 6$"这类金额当成公式）。
    .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre: string, tex: string) => pre + hold(renderMath(tex, false)));

  text = text.replace(new RegExp(`${CODE}(\\d+)${CODE}`, 'g'), (_, i: string) => codeBlocks[Number(i)]!);
  let html = marked.parse(text, { async: false });
  html = html.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_, i: string) => formulas[Number(i)]!);
  // 独立公式单独成段时，去掉多余的 <p> 包裹。
  html = html.replace(/<p>\s*(<span class="katex-display">[\s\S]*?<\/span>)\s*<\/p>/g, '$1');
  return DOMPurify.sanitize(html, { ADD_TAGS: ['semantics', 'annotation'], ADD_ATTR: ['encoding'] });
}

/** 把 Markdown + 公式转成适合朗读的纯文本（阶段 4 会用专门的朗读稿替代）。 */
export function toSpeechText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\$\$?([^$]+)\$\$?/g, (_, tex: string) => texToSpeech(tex))
    .replace(/[#>*_`|]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function texToSpeech(tex: string): string {
  return tex
    .replace(/\^\s*\{?\\circ\}?/g, '度')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$2分之$1')
    .replace(/\\sqrt\{([^}]*)\}/g, '根号$1')
    .replace(/\^2/g, '的平方')
    .replace(/\^3/g, '的立方')
    .replace(/\\angle\s*/g, '角')
    .replace(/\\triangle\s*/g, '三角形')
    .replace(/\\perp/g, '垂直于')
    .replace(/\\parallel/g, '平行于')
    .replace(/\\cong/g, '全等于')
    .replace(/\\sim/g, '相似于')
    .replace(/\\leq?/g, '小于等于')
    .replace(/\\geq?/g, '大于等于')
    .replace(/\\neq?/g, '不等于')
    .replace(/\\times/g, '乘')
    .replace(/\\div/g, '除以')
    .replace(/\\pm/g, '正负')
    .replace(/\\cdot/g, '乘')
    .replace(/\\pi/g, '派')
    .replace(/\\circ/g, '度')
    .replace(/\\therefore/g, '所以')
    .replace(/\\because/g, '因为')
    .replace(/</g, '小于')
    .replace(/>/g, '大于')
    .replace(/=/g, '等于')
    .replace(/\+/g, '加')
    .replace(/-/g, '减')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}\\]/g, '');
}
