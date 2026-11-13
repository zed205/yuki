'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useToaster } from '@/components/toast/toaster-provider';

export interface CodeBlockProps {
  language: string;
  code: string;
}

/**
 * Code block with line numbers and a copy button.
 * Ported from the SolidJS client (GitHub-dark palette).
 */
export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const { showSuccess, showError } = useToaster();
  const lines = code.split('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      showSuccess('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError('Failed to copy');
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-[#30363d]">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-[#30363d] bg-[#161b22] px-3 py-1.5">
        <span className="font-mono text-xs text-[#8b949e]">
          {language || 'code'}
        </span>
        <button
          onClick={() => void handleCopy()}
          className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#c9d1d9]"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={10} /> Copied
            </>
          ) : (
            <>
              <Copy size={10} /> Copy
            </>
          )}
        </button>
      </div>
      {/* Code content with line numbers */}
      <div className="flex overflow-x-auto bg-[#0d1117]">
        <div className="flex-shrink-0 select-none border-r border-[#30363d]/50 bg-[#0d1117] py-3 pl-3 pr-3 text-right">
          {lines.map((_, i) => (
            <span
              key={i}
              className="block font-mono text-[11px] leading-relaxed text-[#484f58]"
            >
              {i + 1}
            </span>
          ))}
        </div>
        <pre className="flex-1 overflow-x-auto py-3 pr-3">
          <code className="font-mono text-[12px] leading-relaxed text-[#c9d1d9]">
            {lines.map((line, i) => (
              <div key={i} className="block whitespace-pre">
                {line || ' '}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
