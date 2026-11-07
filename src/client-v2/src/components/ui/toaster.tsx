import { For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast';
import { useToast } from './use-toast';

export function Toaster() {
  const { toasts } = useToast();

  return (
    <Portal>
      <ToastProvider swipeDirection="right">
        <For each={toasts()}>
          {(toast) => (
            <Show when={toast.type !== 'remove'}>
              <Toast>
                <ToastTitle>{toast.title}</ToastTitle>
                <ToastDescription>{toast.description}</ToastDescription>
                <ToastClose />
              </Toast>
            </Show>
          )}
        </For>
        <ToastViewport />
      </ToastProvider>
    </Portal>
  );
}
