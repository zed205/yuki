'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ClipboardEvent,
} from 'react';
import { Paperclip, Send, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/context/session-context';

export interface FileAttachment {
  type: 'image' | 'file';
  name: string;
  dataUrl?: string;
  file?: File;
  size?: number;
}

export interface ComposerProps {
  onSubmit: (content: string, attachments: FileAttachment[]) => void;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Message input composer with textarea, send/stop buttons, and
 * file/image attachment support (paste, picker, drag-and-drop).
 */
export function Composer(props: ComposerProps) {
  const { isStreaming, isWaiting } = useSession();
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-resize the textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        const dataUrl = await readAsDataUrl(file);
        setAttachments((prev) => [
          ...prev,
          {
            type: file.type.startsWith('image/') ? 'image' : 'file',
            name: file.name,
            dataUrl,
            file,
            size: file.size,
          },
        ]);
      } catch {
        /* skip unreadable files */
      }
    }
  }, []);

  const handleSubmit = () => {
    const content = value.trim();
    if (!content && attachments.length === 0) return;
    if (isStreaming) return;
    props.onSubmit(content, attachments);
    setValue('');
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault();
      props.onStop?.();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void addFiles(imageFiles);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addFiles(e.target.files);
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
  };

  const removeAttachment = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index));

  const hasContent = value.trim().length > 0;
  const hasAttachments = attachments.length > 0;
  const isBusy = isWaiting || isStreaming;

  const placeholder = props.placeholder || 'Type a message...';

  return (
    <div
      className="border-t border-[#30363d] bg-[#0d1117] px-3 py-3"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="relative mx-auto max-w-4xl">
        {/* Attachment previews */}
        {hasAttachments && (
          <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
            {attachments.map((attachment, index) => (
              <div key={`${attachment.name}-${index}`} className="group relative flex-shrink-0">
                {attachment.type === 'image' && attachment.dataUrl ? (
                  <div className="relative overflow-hidden rounded-lg border border-[#30363d]">
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      className="h-20 w-auto rounded-lg object-cover"
                    />
                    <button
                      onClick={() => removeAttachment(index)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#da3633] text-[10px] text-white opacity-0 transition-opacity hover:bg-[#f85149] group-hover:opacity-100"
                      title="Remove attachment"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#8b949e]">
                    <Paperclip size={10} />
                    <span className="max-w-[150px] truncate">{attachment.name}</span>
                    {attachment.size ? (
                      <span className="text-xs">{formatFileSize(attachment.size)}</span>
                    ) : null}
                    <button
                      onClick={() => removeAttachment(index)}
                      className="text-xs text-[#8b949e] hover:text-[#f85149]"
                      title="Remove attachment"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Composer container */}
        <div
          className={cn(
            'flex items-end gap-2 rounded-xl border transition-colors',
            isDragging
              ? 'border-[#58a6ff] bg-[rgba(88,166,255,0.08)]'
              : 'border-[#30363d] bg-[#161b22]',
            isFocused && 'border-[#58a6ff]/50',
          )}
        >
          <div className="flex flex-1 flex-col">
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={props.disabled}
              placeholder={isBusy ? 'Steer the running task… (Enter to send)' : placeholder}
              className="composer-textarea w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-[#c9d1d9] outline-none placeholder:text-[#8b949e]"
            />
          </div>

          {/* Left actions */}
          <div className="flex items-center gap-0.5 px-1 pb-1">
            <button
              className="rounded-md p-1.5 text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#c9d1d9]"
              title="Attach file"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={16} />
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                accept="image/*,.pdf,.txt,.json,.xml,.yaml,.yml,.md,.csv"
              />
            </button>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-0.5 px-1 pb-1">
            {isBusy ? (
              <button
                className="flex items-center gap-1 rounded-md bg-[#da3633]/90 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#da3633]"
                onClick={() => props.onStop?.()}
              >
                <Square size={10} /> Stop
              </button>
            ) : (
              <button
                className={cn(
                  'flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  hasContent || hasAttachments
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'text-muted-foreground hover:bg-[#21262d]',
                )}
                disabled={!hasContent && !hasAttachments}
                onClick={handleSubmit}
              >
                <Send size={12} />
                {hasAttachments && hasContent ? 'Send + Files' : 'Send'}
              </button>
            )}
          </div>
        </div>

        {/* Drop zone overlay */}
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-[#58a6ff] bg-[#0d1117]/80">
            <div className="text-center text-[#58a6ff]">
              <span className="text-lg">📁</span>
              <p className="mt-1 text-sm">Drop files here</p>
            </div>
          </div>
        )}

        {/* Footer hint */}
        <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-[#484f58]">
          <span>Enter</span>
          <span>to send</span>
          <span className="mx-0.5">·</span>
          <span>Shift+Enter</span>
          <span>for newline</span>
        </div>
      </div>
    </div>
  );
}
