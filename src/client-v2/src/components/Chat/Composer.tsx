import { createSignal, createEffect, Show, splitProps } from 'solid-js';
import { Textarea } from '../ui/Textarea';
import { Button } from '../ui/Button';
import { useSession } from '../../context/SessionContext';
import { useToaster } from '../Toast/ToasterProvider';

export interface ComposerProps {
  /** Called when user submits a message */
  onSubmit: (content: string, attachments: FileAttachment[]) => void;
  /** Called when user clicks stop */
  onStop?: () => void;
  /** Placeholder text for the textarea */
  placeholder?: string;
  /** Disabled state */
  disabled?: boolean;
}

export interface FileAttachment {
  type: 'image' | 'file';
  name: string;
  dataUrl?: string; // For images (base64)
  file?: File; // For files
  size?: number;
}

/**
 * Message input composer with text area, send/stop buttons,
 * and file/image attachment support.
 */
export function Composer(props: ComposerProps) {
  const [local] = splitProps(props, [
    'onSubmit',
    'onStop',
    'placeholder',
    'disabled',
  ]);

  const { isStreaming, isWaiting } = useSession();
  const { addToast } = useToaster();

  const [value, setValue] = createSignal('');
  const [attachments, setAttachments] = createSignal<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isFocused, setIsFocused] = createSignal(false);

  // Adjust textarea height based on content
  createEffect(() => {
    const textarea = document.querySelector('.composer-textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  });

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setValue(target.value);
  };

  const handleSubmit = () => {
    const content = value().trim();
    if (!content && attachments().length === 0) return;
    if (isStreaming()) return;

    props.onSubmit(content, attachments());
    setValue('');
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Enter to send (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Stop streaming on Escape when active
    if (e.key === 'Escape' && isStreaming()) {
      e.preventDefault();
      local.onStop?.();
    }
  };

  const handleStop = () => {
    local.onStop?.();
  };

  const handlePaste = (e: ClipboardEvent) => {
    // Handle image paste
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            {
              type: 'image',
              name: file.name,
              dataUrl: reader.result as string,
              file,
              size: file.size,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleFileSelect = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            {
              type: 'image',
              name: file.name,
              dataUrl: reader.result as string,
              file,
              size: file.size,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setAttachments((prev) => [
          ...prev,
          {
            type: 'file',
            name: file.name,
            file,
            size: file.size,
          },
        ]);
      }
    }

    // Reset input so the same file can be selected again
    input.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments((prev) => [
            ...prev,
            {
              type: 'image',
              name: file.name,
              dataUrl: reader.result as string,
              file,
              size: file.size,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setAttachments((prev) => [
          ...prev,
          {
            type: 'file',
            name: file.name,
            file,
            size: file.size,
          },
        ]);
      }
    }
  };

  const hasContent = () => value().trim().length > 0;
  const hasAttachments = () => attachments().length > 0;
  const isBusy = isWaiting() || isStreaming();

  const placeholder = props.placeholder || 'Type a message...';

  return (
    <div
      class={[
        'border-t border-[#30363d] bg-[#0d1117] px-3 py-3',
      ]}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="max-w-4xl mx-auto">
        {/* Attachment preview */}
        <Show when={hasAttachments()}>
          <div class="flex gap-2 mb-3 overflow-x-auto pb-1">
            <For each={attachments()}>
              {(attachment, index) => (
                <div class="relative flex-shrink-0 group">
                  <Show
                    when={attachment.type === 'image'}
                    fallback={
                      <div class="flex items-center gap-2 bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-[#8b949e]">
                        <span class="text-[10px]">📎</span>
                        <span class="truncate max-w-[150px]">{attachment.name}</span>
                        <span class="text-xs">
                          {attachment.size
                            ? formatFileSize(attachment.size)
                            : ''}
                        </span>
                      </div>
                    }
                  >
                    <div class="relative rounded-lg overflow-hidden border border-[#30363d]">
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        class="h-20 w-auto rounded-lg object-cover"
                      />
                      <button
                        onClick={() => removeAttachment(index())}
                        class="absolute -top-1.5 -right-1.5 bg-[#da3633] text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[#f85149]"
                        title="Remove attachment"
                      >
                        ✕
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Composer container */}
        <div
          class={[
            'flex items-end gap-2 rounded-xl border transition-colors',
            isDragging()
              ? 'border-[#58a6ff] bg-[rgba(88,166,255,0.08)]'
              : 'border-[#30363d] bg-[#161b22]',
            isFocused() && 'border-[#58a6ff]/50',
          ]}
        >
          {/* Text input */}
          <div class="flex-1 flex flex-col">
            <Textarea
              class="composer-textarea bg-transparent border-none focus-visible:ring-0 resize-none px-3 py-2.5 text-[#c9d1d9] placeholder:text-[#8b949e] text-sm leading-relaxed"
              placeholder={
                isBusy ? `Steer the running task… (Enter to send)` : placeholder
              }
              value={value()}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onfocus={() => setIsFocused(true)}
              onblur={() => setIsFocused(false)}
              disabled={props.disabled}
              rows={1}
            />
          </div>

          {/* Left action buttons */}
          <div class="flex items-center gap-0.5 px-1 pb-1">
            {/* File attachment button */}
            <label
              class="cursor-pointer text-[#8b949e] hover:text-[#c9d1d9] p-1.5 rounded-md hover:bg-[#21262d] transition-colors"
              title="Attach file"
            >
              <input
                type="file"
                multiple
                class="hidden"
                onChange={handleFileSelect}
                accept="image/*,.pdf,.txt,.json,.xml,.yaml,.yml,.md,.csv"
              />
              <span class="text-sm">📎</span>
            </label>
          </div>

          {/* Action buttons (right side) */}
          <div class="flex items-center gap-0.5 px-1 pb-1">
            {/* Stop button (during streaming) */}
            <Show when={isBusy}>
              <Button
                variant="danger"
                size="sm"
                onClick={handleStop}
                class="rounded-md"
              >
                <span class="text-xs">■ Stop</span>
              </Button>
            </Show>

            {/* Send button */}
            <Show when={!isBusy()}>
              <Button
                variant={hasContent() ? 'primary' : 'ghost'}
                size="sm"
                onClick={handleSubmit}
                disabled={!hasContent() && !hasAttachments()}
                class="rounded-md"
              >
                <span class="text-sm">
                  {hasAttachments() && hasContent() ? 'Send + Files' : 'Send'}
                </span>
              </Button>
            </Show>
          </div>
        </div>

        {/* Drop zone overlay hint */}
        <Show when={isDragging()}>
          <div class="absolute inset-0 flex items-center justify-center bg-[#0d1117]/80 rounded-xl border-2 border-dashed border-[#58a6ff] z-10 pointer-events-none">
            <div class="text-center text-[#58a6ff]">
              <span class="text-lg">📁</span>
              <p class="text-sm mt-1">Drop files here</p>
            </div>
          </div>
        </Show>

        {/* Footer hint */}
        <div class="flex items-center justify-center mt-2 text-[10px] text-[#484f58] gap-1">
          <span>Enter</span>
          <span>to send</span>
          <span class="mx-0.5">·</span>
          <span>Shift+Enter</span>
          <span>for newline</span>
        </div>
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
