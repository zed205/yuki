'use client';

import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';
import { CodeBlock } from './code-block';

/**
 * Markdown renderer for assistant messages.
 *
 * Replaces the SolidJS client's hand-rolled markdown parser with a proper
 * react-markdown pipeline (GFM tables/strikethrough included). Code blocks
 * render with the shared CodeBlock (line numbers + copy button).
 */

const components: Components = {
  code({ className, children, ...props }) {
    const text = String(children).replace(/\n$/, '');
    const match = /language-(\w+)/.exec(className || '');
    const isFenced = match || text.includes('\n');
    if (isFenced) {
      return <CodeBlock language={match?.[1] || ''} code={text} />;
    }
    return (
      <code
        className="rounded border border-[#30363d] bg-[#21262d] px-1 py-0.5 font-mono text-[13px] text-[#c9d1d9]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    // CodeBlock handles its own <pre>-like layout; don't double-wrap.
    return <>{children}</>;
  },
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#58a6ff] underline-offset-2 hover:text-[#79c0ff] hover:underline"
        {...props}
      >
        {children}
      </a>
    );
  },
  strong({ children, ...props }) {
    return (
      <strong className="font-medium text-[#58a6ff]" {...props}>
        {children}
      </strong>
    );
  },
  table({ children, ...props }) {
    return (
      <table
        className="my-2 w-full border-collapse text-sm"
        {...props}
      >
        {children}
      </table>
    );
  },
  th({ children, ...props }) {
    return (
      <th
        className="border border-[#30363d] bg-[#161b22] px-2 py-1 text-left text-xs font-medium text-[#8b949e]"
        {...props}
      >
        {children}
      </th>
    );
  },
  td({ children, ...props }) {
    return (
      <td className="border border-[#30363d] px-2 py-1" {...props}>
        {children}
      </td>
    );
  },
  ul({ children, ...props }) {
    return <ul className="my-1 list-disc space-y-0.5 pl-5" {...props}>{children}</ul>;
  },
  ol({ children, ...props }) {
    return <ol className="my-1 list-decimal space-y-0.5 pl-5" {...props}>{children}</ol>;
  },
  p({ children, ...props }) {
    return <p className="my-1.5 leading-relaxed" {...props}>{children}</p>;
  },
  h1({ children, ...props }) {
    return <h1 className="mb-2 mt-3 text-lg font-semibold text-[var(--yuki-heading)]" {...props}>{children}</h1>;
  },
  h2({ children, ...props }) {
    return <h2 className="mb-2 mt-3 text-base font-semibold text-[var(--yuki-heading)]" {...props}>{children}</h2>;
  },
  h3({ children, ...props }) {
    return <h3 className="mb-1.5 mt-2 text-sm font-semibold text-[var(--yuki-heading)]" {...props}>{children}</h3>;
  },
};

export function MarkdownContent({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="message-content text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
