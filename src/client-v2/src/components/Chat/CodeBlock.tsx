import { createSignal } from 'solid-js';
import { Show } from 'solid-js';
import { useToaster } from '../Toast/ToasterProvider';

export interface CodeBlockProps {
  language: string;
  code: string;
}

/**
 * Syntax-highlighted code block component with line numbers and copy button.
 * Matches Yuki's dark theme styling.
 */
export function CodeBlock(props: CodeBlockProps) {
  const [copied, setCopied] = createSignal(false);
  const { addToast } = useToaster();
  const lines = props.code.split('\n');
  const lineNumbers = lines.map((_, i) => i + 1);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      addToast('Copied to clipboard', 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Failed to copy', 'error', 2000);
    }
  };

  return (
    <div class="my-2 rounded-md overflow-hidden border border-[#30363d]">
      {/* Header bar */}
      <div class="flex items-center justify-between bg-[#161b22] px-3 py-1.5 border-b border-[#30363d]">
        <span class="text-xs text-[#8b949e] font-mono">
          {props.language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          class="text-xs text-[#8b949e] hover:text-[#c9d1d9] transition-colors flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-[#21262d]"
          title="Copy code"
        >
          <Show
            when={copied()}
            fallback={
              <>
                <span class="text-[10px]">📋</span> Copy
              </>
            }
          >
            <span class="text-[10px]">✓</span> Copied
          </Show>
        </button>
      </div>
      {/* Code content with line numbers */}
      <div class="flex overflow-x-auto bg-[#0d1117]">
        {/* Line numbers gutter */}
        <div class="flex-shrink-0 select-none text-right pr-3 pl-3 py-3 bg-[#0d1117] border-r border-[#30363d]/50">
          {lineNumbers.map((num) => (
            <span
              class="text-[11px] leading-relaxed text-[#484f58] font-mono block"
              key={num}
            >
              {num}
            </span>
          ))}
        </div>
        {/* Code content */}
        <pre class="flex-1 overflow-x-auto py-3 pr-3">
          <code class="text-[12px] leading-relaxed font-mono text-[#c9d1d9]">
            {lines.map((line, i) => (
              <div key={i} class="block whitespace-pre">
                {line || ' '}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
