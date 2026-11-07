import { Show } from 'solid-js';
import { CodeBlock } from './CodeBlock';

/**
 * Wrapper for rendering code blocks inside MessageBubble's markdown rendering.
 * Uses innerHTML with a custom element that gets hydrated by SolidJS.
 */
export function CodeBlockWrapper(props: { lang: string; code: string }) {
  return (
    <CodeBlock
      language={props.lang}
      code={props.code}
    />
  );
}
