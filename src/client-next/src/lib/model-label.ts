import type { StructuredModel } from './types';

/** Split a qualified selection name ("Name / Variant") into model + variant. */
export function parseModelSelection(qualifiedName?: string): {
  modelName: string;
  variantName: string | null;
} {
  const q = qualifiedName || '';
  const idx = q.indexOf(' / ');
  if (idx === -1) return { modelName: q, variantName: null };
  return { modelName: q.slice(0, idx), variantName: q.slice(idx + 3) };
}

export interface ModelLabel {
  /** "Name / Variant" (variant always resolved, incl. the default one). */
  display: string;
  modelName: string | null;
  variantName: string | null;
  /** Underlying model string (e.g. the GGUF/LLM name), if known. */
  modelRef: string;
}

/**
 * Build the sidebar model label ("Name / Variant") from structured model
 * data, mirroring the legacy client's updateModelLabel.
 */
export function buildModelLabel(
  structuredModels: StructuredModel[],
  activeModel?: string,
): ModelLabel {
  const { modelName, variantName } = parseModelSelection(activeModel);
  const model = structuredModels.find((m) => m.name === modelName);
  const name = model ? model.name : modelName || '—';

  let displayVariant = variantName;
  if (!displayVariant && model && model.variants?.length) {
    const def =
      model.variants.find((v) => v.qualifiedName === modelName) ||
      model.variants.find((v) => v.isDefault) ||
      model.variants[0];
    displayVariant = def ? def.name : null;
  }

  return {
    display: displayVariant ? `${name} / ${displayVariant}` : name,
    modelName: name === '—' ? null : name,
    variantName: displayVariant,
    modelRef: model?.model || modelName || '',
  };
}

/** Reduce an endpoint URL to "host:port" for the utility summary. */
export function endpointHostPort(endpoint?: string): {
  hostPort: string;
  isSecure: boolean;
} {
  if (!endpoint) return { hostPort: '—', isSecure: false };
  try {
    const u = new URL(endpoint);
    return {
      hostPort: u.hostname + (u.port ? ':' + u.port : ''),
      isSecure: u.protocol === 'https:',
    };
  } catch {
    return { hostPort: endpoint, isSecure: false };
  }
}

/** Format a token count as "25.2k" (legacy utility-summary style). */
export function formatK(n: number): string {
  return `${Math.round(n / 100) / 10}k`;
}

/**
 * Live elapsed seconds for a sub-agent: the server-reported baseline plus
 * the time since the client last saw an event for it (legacy _baseAt logic).
 */
export function formatAgentElapsed(
  agent: { elapsedSeconds?: number; status?: string; baseAt?: number },
): number {
  const base = Number(agent.elapsedSeconds) || 0;
  const at = agent.baseAt || 0;
  const live =
    agent.status === 'running' || agent.status === 'queued'
      ? at > 0
        ? (Date.now() - at) / 1000
        : 0
      : 0;
  return Math.max(0, Math.round(base + live));
}
