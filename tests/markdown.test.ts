// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, toSpeechText } from '../web/src/markdown.ts';
import { splitSentences } from '../web/src/speech.ts';

describe('Markdown + 公式渲染', () => {
  it('渲染行内和独立公式', () => {
    const html = renderMarkdown('设 $x_1+x_2=3$，则\n\n$$\\frac{a}{b}=2$$');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    // 下划线没有被当成斜体
    expect(html).not.toContain('<em>');
  });

  it('不把普通数字和金额当成公式，代码里的内容保持原样', () => {
    const html = renderMarkdown('共 3 个点，价格是 5$ 和 6$。代码 `a_1 $x$` 保持原样');
    expect(html).not.toContain('katex');
    expect(html).toContain('3 个点');
    expect(html).toContain('<code>a_1 $x$</code>');
  });

  it('支持 \\( \\) 和 \\[ \\] 分隔符', () => {
    const html = renderMarkdown('由 \\(a^2+b^2=c^2\\) 得\n\\[c=5\\]');
    expect(html.match(/class="katex"/g)?.length).toBe(2);
  });

  it('过滤危险的 HTML', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>正文');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
    expect(html).toContain('正文');
  });

  it('加粗与列表', () => {
    const html = renderMarkdown('1. 第一步\n2. 第二步\n\n**答案：** $t=2$');
    expect(html).toContain('<ol>');
    expect(html).toContain('<strong>答案：</strong>');
  });
});

describe('朗读文本', () => {
  it('把常见公式读成中文', () => {
    expect(toSpeechText('$AP=2t$')).toBe('AP等于2t');
    expect(toSpeechText('$\\frac{1}{2}$')).toBe('2分之1');
    expect(toSpeechText('$\\angle ABC=90^\\circ$')).toBe('角ABC等于90度');
    expect(toSpeechText('**答案：** $x^2$')).toBe('答案： x的平方');
  });

  it('按句子切分长文本', () => {
    expect(splitSentences('第一句。第二句！\n第三句')).toEqual(['第一句。', '第二句！', '第三句']);
  });
});
