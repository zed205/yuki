'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { useSession } from '@/context/session-context';
import { ConfirmModal } from '@/components/modals/confirm-modal';
import type { StructuredModel, StructuredVariant } from '@/lib/types';

const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

type FormMode =
  | { type: 'model'; id: string | null }
  | { type: 'variant'; modelId: string; id: string | null };

interface ConfirmState {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

export interface ModelsModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

async function modelsRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch('/api/models' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);
  return data;
}

export function ModelsModal({ open, onOpenChange }: ModelsModalProps) {
  const { activeModel } = useSession();
  const [models, setModels] = useState<StructuredModel[]>([]);
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Model form state
  const [mForm, setMForm] = useState({
    name: '',
    model: '',
    endpoint: '',
    apiKey: '',
    contextWindow: '',
    maxTokens: '',
  });
  // Variant form state
  const [vForm, setVForm] = useState({
    name: '',
    temperature: '',
    reasoningEffort: 'default',
    thinking: 'inherit',
    preserve: 'default',
    isDefault: false,
  });

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      const data = (await res.json()) as {
        models: StructuredModel[];
        activeModel: string;
      };
      setModels(data.models || []);
    } catch {
      /* keep cached list */
    }
  }, []);

  useEffect(() => {
    if (open) {
      setFormMode(null);
      setError('');
      void fetchModels();
    }
  }, [open, fetchModels]);

  const openModelForm = (id: string | null) => {
    if (id) {
      const m = models.find((x) => x.id === id);
      if (m) {
        setMForm({
          name: m.name,
          model: m.model,
          endpoint: m.endpoint,
          apiKey: '',
          contextWindow: m.contextWindow != null ? String(m.contextWindow) : '',
          maxTokens: m.maxTokens != null ? String(m.maxTokens) : '',
        });
      }
    } else {
      setMForm({
        name: '',
        model: '',
        endpoint: '',
        apiKey: '',
        contextWindow: '',
        maxTokens: '',
      });
    }
    setError('');
    setFormMode({ type: 'model', id });
  };

  const openVariantForm = (modelId: string, id: string | null) => {
    const model = models.find((m) => m.id === modelId);
    const v = id && model ? model.variants.find((x) => x.id === id) : null;
    setVForm({
      name: v?.name ?? '',
      temperature: v && v.temperature != null ? String(v.temperature) : '',
      reasoningEffort: v?.reasoningEffort ?? 'default',
      thinking:
        v && v.thinkingEnabled != null
          ? v.thinkingEnabled
            ? 'on'
            : 'off'
          : 'inherit',
      preserve:
        v && v.preserveThinking != null
          ? v.preserveThinking
            ? 'on'
            : 'off'
          : 'default',
      isDefault: v?.isDefault ?? false,
    });
    setError('');
    setFormMode({ type: 'variant', modelId, id });
  };

  const cancelForm = () => {
    setFormMode(null);
    setError('');
  };

  const num = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const saveModel = async () => {
    const id = formMode?.type === 'model' ? formMode.id : null;
    const body: Record<string, unknown> = {
      name: mForm.name.trim(),
      model: mForm.model.trim() || undefined,
      endpoint: mForm.endpoint.trim(),
      contextWindow: num(mForm.contextWindow),
      maxTokens: num(mForm.maxTokens),
    };
    if (id) {
      if (mForm.apiKey.trim()) body.apiKey = mForm.apiKey.trim();
      try {
        await modelsRequest(`/${id}`, 'PUT', body);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    } else {
      body.apiKey = mForm.apiKey.trim() || '';
      body.variant = { name: 'Default' };
      try {
        await modelsRequest('', 'POST', body);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setFormMode(null);
    setError('');
    await fetchModels();
  };

  const saveVariant = async () => {
    if (formMode?.type !== 'variant') return;
    const { modelId, id } = formMode;
    const body = {
      name: vForm.name.trim(),
      temperature: num(vForm.temperature),
      thinkingEnabled: vForm.thinking === 'inherit' ? null : vForm.thinking === 'on',
      preserveThinking: vForm.preserve === 'default' ? null : vForm.preserve === 'on',
      reasoningEffort: vForm.reasoningEffort === 'default' ? null : vForm.reasoningEffort,
      isDefault: vForm.isDefault,
    };
    try {
      await modelsRequest(
        id ? `/${modelId}/variants/${id}` : `/${modelId}/variants`,
        id ? 'PUT' : 'POST',
        body,
      );
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setFormMode(null);
    setError('');
    await fetchModels();
  };

  const deleteModel = (id: string) => {
    const m = models.find((x) => x.id === id);
    setConfirm({
      title: 'Delete Model',
      message: `Delete “${m?.name ?? ''}” and all of its variants? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await modelsRequest(`/${id}`, 'DELETE');
          await fetchModels();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  };

  const deleteVariant = (modelId: string, id: string) => {
    const m = models.find((x) => x.id === modelId);
    const v = m?.variants.find((x) => x.id === id);
    setConfirm({
      title: 'Delete Variant',
      message: `Delete variant “${v?.name ?? ''}”${m ? ` from ${m.name}` : ''}?`,
      onConfirm: async () => {
        try {
          await modelsRequest(`/${modelId}/variants/${id}`, 'DELETE');
          await fetchModels();
        } catch (e) {
          setError((e as Error).message);
        }
      },
    });
  };

  const setActive = async (qualified: string) => {
    try {
      await modelsRequest('/active', 'PUT', { name: qualified });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const variantMetaText = (v: StructuredVariant) => {
    const parts: string[] = [];
    if (v.temperature != null) parts.push(`temp ${v.temperature}`);
    if (v.thinkingEnabled != null) parts.push(`thinking ${v.thinkingEnabled ? 'on' : 'off'}`);
    if (v.preserveThinking === false) parts.push('no preserve');
    if (v.reasoningEffort) parts.push(`effort ${v.reasoningEffort}`);
    return parts.length ? parts.join(' · ') : 'defaults';
  };

  const detailText = (m: StructuredModel) =>
    [
      m.model,
      '@',
      m.endpoint,
      m.contextWindow ? `· ctx ${m.contextWindow}` : '',
      m.maxTokens != null && m.maxTokens >= 0 ? `· max ${m.maxTokens}` : '',
    ]
      .filter(Boolean)
      .join(' ');

  const field = (
    id: string,
    label: string,
    value: string,
    placeholder: string,
    hint: string,
    onChange: (v: string) => void,
    type: 'text' | 'number' = 'text',
  ) => (
    <div key={id}>
      <label className="mb-1 block text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );

  const isModelForm = formMode?.type === 'model';
  const isVariantForm = formMode?.type === 'variant';
  const editingModel = isModelForm && formMode?.id ? models.find((m) => m.id === formMode.id) : null;
  const variantModel = isVariantForm && formMode ? models.find((m) => m.id === formMode.modelId) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Legacy width: w-[760px] max-w-[95vw]. sm:max-w-[95vw] overrides the shadcn default
            sm:max-w-sm (384px) which otherwise caps the dialog far too narrow. */}
        <DialogContent className="flex max-h-[85vh] w-[760px] max-w-[95vw] sm:max-w-[95vw] flex-col gap-0 p-0">
          <DialogHeader className="flex-row items-center justify-between border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold">Models</DialogTitle>
            {!formMode && (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => openModelForm(null)}
                  className="bg-[#d4760a] text-white hover:bg-[#e08a2a]"
                >
                  + New Model
                </Button>
              </div>
            )}
          </DialogHeader>

          <ScrollArea className="max-h-[calc(85vh-49px)]">
            <div className="p-4">
              {/* ─── List view ─── */}
              {!formMode && (
                <>
                  {models.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No models yet. Click “+ New Model” to add one.
                    </div>
                  ) : (
                    models.map((m) => {
                      const isActive =
                        activeModel === m.name ||
                        (activeModel || '').startsWith(m.name + ' / ');
                      return (
                        <div key={m.id} className="mb-3 rounded-lg border border-border">
                          <div className="flex items-center gap-2 px-3 py-2">
                            <span className="truncate text-sm font-semibold" title={m.name}>
                              {m.name}
                            </span>
                            {isActive && (
                              <span className="shrink-0 rounded border border-[#58a6ff]/40 bg-[#58a6ff]/15 px-1.5 py-0.5 text-[10px] text-[#58a6ff]">
                                Active
                              </span>
                            )}
                            <span className="ml-auto flex shrink-0 items-center gap-1">
                              <button
                                onClick={() => openModelForm(m.id)}
                                className="rounded bg-[#21262d] px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteModel(m.id)}
                                className="rounded bg-[#21262d] px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-[#f85149]"
                              >
                                Delete
                              </button>
                            </span>
                          </div>
                          <div className="truncate px-3 pb-2 text-xs text-muted-foreground" title={detailText(m)}>
                            {detailText(m)}
                          </div>
                          <div className="border-t border-border px-3 py-1.5">
                            {m.variants.length === 0 ? (
                              <div className="py-1 text-xs text-muted-foreground">No variants</div>
                            ) : (
                              m.variants.map((v) => (
                                <div key={v.id} className="flex items-center gap-2 py-1 text-xs">
                                  <input
                                    type="checkbox"
                                    className="shrink-0 cursor-pointer accent-[#d4760a]"
                                    title="Set as active model"
                                    checked={v.qualifiedName === activeModel}
                                    onChange={(e) => {
                                      if (e.target.checked) void setActive(v.qualifiedName);
                                    }}
                                  />
                                  <span className="w-3 shrink-0 text-[#58a6ff]" title="Default variant">
                                    {v.isDefault ? '★' : ''}
                                  </span>
                                  <span className="truncate">{v.name}</span>
                                  <span className="truncate text-muted-foreground" title={variantMetaText(v)}>
                                    {variantMetaText(v)}
                                  </span>
                                  <span className="ml-auto flex shrink-0 items-center gap-1">
                                    <button
                                      onClick={() => openVariantForm(m.id, v.id)}
                                      className="rounded bg-[#21262d] px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => deleteVariant(m.id, v.id)}
                                      className="rounded bg-[#21262d] px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-[#f85149]"
                                    >
                                      Delete
                                    </button>
                                  </span>
                                </div>
                              ))
                            )}
                            <button
                              onClick={() => openVariantForm(m.id, null)}
                              className="mt-1 text-xs text-muted-foreground transition-colors hover:text-[#58a6ff]"
                            >
                              + Add variant
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}

              {/* ─── Model form ─── */}
              {isModelForm && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold">
                    {editingModel ? 'Edit Model' : 'New Model'}
                  </h3>
                  <div className="space-y-3">
                    {field('mf-name', 'Name', mForm.name, 'e.g. Qwen3.6 35B (debby)', 'Display name shown in pickers (unique)', (v) => setMForm({ ...mForm, name: v }))}
                    {field('mf-model', 'Model ID', mForm.model, 'unsloth/Qwen3.6-27B-…', 'Model id sent to the provider — blank/placeholder for single-model local servers (llama.cpp)', (v) => setMForm({ ...mForm, model: v }))}
                    {field('mf-endpoint', 'Endpoint', mForm.endpoint, 'http://debby:1234/v1', 'Base URL of the OpenAI-compatible API', (v) => setMForm({ ...mForm, endpoint: v }))}
                    {field('mf-api-key', 'API Key', mForm.apiKey, editingModel ? '••• (leave blank to keep)' : 'Optional for local models', editingModel ? 'Leave blank to keep the stored key' : 'Stored server-side, never re-sent to the client', (v) => setMForm({ ...mForm, apiKey: v }))}
                    <div className="grid grid-cols-2 gap-3">
                      {field('mf-context-window', 'Context Window', mForm.contextWindow, '64000', 'Blank = default', (v) => setMForm({ ...mForm, contextWindow: v }), 'number')}
                      {field('mf-max-tokens', 'Max Tokens', mForm.maxTokens, '-1', 'Response cap; -1 or blank = provider default', (v) => setMForm({ ...mForm, maxTokens: v }), 'number')}
                    </div>
                    {error && <div className="text-xs text-[#f85149]">{error}</div>}
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="ghost" size="sm" onClick={cancelForm}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void saveModel()} className="bg-[#d4760a] text-white hover:bg-[#e08a2a]">
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── Variant form ─── */}
              {isVariantForm && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">
                    {formMode?.id ? 'Edit Variant' : 'New Variant'}
                  </h3>
                  <div className="mb-3 text-xs text-muted-foreground">
                    {variantModel?.name ?? ''}
                  </div>
                  <div className="space-y-3">
                    {field('vf-name', 'Name', vForm.name, 'e.g. Fast, Creative, Deep Think', 'Preset label (unique per model)', (v) => setVForm({ ...vForm, name: v }))}
                    <div className="grid grid-cols-2 gap-3">
                      {field('vf-temperature', 'Temperature', vForm.temperature, 'e.g. 0.7', 'Blank = provider default', (v) => setVForm({ ...vForm, temperature: v }), 'number')}
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="vf-effort">
                          Reasoning Effort
                        </label>
                        <select
                          id="vf-effort"
                          className="w-full rounded-lg border border-border bg-[#21262d] px-3 py-2 text-sm focus:outline-none focus:border-[#58a6ff]"
                          value={vForm.reasoningEffort}
                          onChange={(e) => setVForm({ ...vForm, reasoningEffort: e.target.value })}
                        >
                          {['default', ...REASONING_EFFORTS].map((x) => (
                            <option key={x} value={x}>
                              {x === 'default' ? 'Default' : x}
                            </option>
                          ))}
                        </select>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Applies when thinking is on</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="vf-thinking">
                          Thinking
                        </label>
                        <select
                          id="vf-thinking"
                          className="w-full rounded-lg border border-border bg-[#21262d] px-3 py-2 text-sm focus:outline-none focus:border-[#58a6ff]"
                          value={vForm.thinking}
                          onChange={(e) => setVForm({ ...vForm, thinking: e.target.value })}
                        >
                          <option value="inherit">Inherit (global)</option>
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground" htmlFor="vf-preserve">
                          Preserve Thinking
                        </label>
                        <select
                          id="vf-preserve"
                          className="w-full rounded-lg border border-border bg-[#21262d] px-3 py-2 text-sm focus:outline-none focus:border-[#58a6ff]"
                          value={vForm.preserve}
                          onChange={(e) => setVForm({ ...vForm, preserve: e.target.value })}
                        >
                          <option value="default">Default (on)</option>
                          <option value="on">On</option>
                          <option value="off">Off</option>
                        </select>
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-[#d4760a]"
                        checked={vForm.isDefault}
                        onChange={(e) => setVForm({ ...vForm, isDefault: e.target.checked })}
                      />
                      Default variant
                    </label>
                    {error && <div className="text-xs text-[#f85149]">{error}</div>}
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="ghost" size="sm" onClick={cancelForm}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => void saveVariant()} className="bg-[#d4760a] text-white hover:bg-[#e08a2a]">
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <ScrollBar orientation="vertical" />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
        title={confirm?.title}
        message={confirm?.message}
        confirmText="Delete"
        variant="danger"
        onConfirm={() => {
          const action = confirm?.onConfirm;
          setConfirm(null);
          if (action) void action();
        }}
      />
    </>
  );
}
