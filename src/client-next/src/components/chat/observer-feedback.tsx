'use client';

import type { ObserverFeedback } from '@/lib/types';

/**
 * Observer feedback block (legacy amber block):
 * Renders status, concern, and suggestion from observer:feedback event.
 */
export function ObserverFeedbackBlock({ feedback }: { feedback: ObserverFeedback }) {
  return (
    <div className="mt-2 rounded-lg border border-yellow-600/30 bg-yellow-600/8 px-3 py-2 text-xs leading-relaxed text-yellow-200">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-yellow-300">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Observer
      </div>
      {feedback.status && (
        <div className="mb-1">
          <span className="font-medium text-yellow-300">Status:</span>{' '}
          <span className="text-yellow-100">{feedback.status}</span>
        </div>
      )}
      {feedback.concern && (
        <div className="mb-1">
          <span className="font-medium text-yellow-300">Concern:</span>{' '}
          <span className="text-yellow-100">{feedback.concern}</span>
        </div>
      )}
      {feedback.suggestion && (
        <div>
          <span className="font-medium text-yellow-300">Suggestion:</span>{' '}
          <span className="text-yellow-100">{feedback.suggestion}</span>
        </div>
      )}
    </div>
  );
}
