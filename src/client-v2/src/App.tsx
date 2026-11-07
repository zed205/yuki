import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { SessionProvider } from './context/SessionContext';
import { AudioProvider } from './context/AudioContext';
import { BrowserProvider } from './context/BrowserContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { ProjectProvider } from './context/ProjectContext';
import { ToasterProvider } from './components/Toast/ToasterProvider';
import { MainLayout } from './components/Layout/MainLayout';
import { SessionSync } from './components/SessionSync';
import { createRenderEffect } from 'solid-js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false },
  },
});

export default function App() {
  createRenderEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add(
      'font-(family-name:--font-family-text)',
      'text-[13px]',
      'font-[440]'
    );
  });

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <AudioProvider>
          <BrowserProvider>
            <ProjectProvider>
              <WebSocketProvider>
                <ToasterProvider>
                  <MainLayout />
                </ToasterProvider>
                <SessionSync />
              </WebSocketProvider>
            </ProjectProvider>
          </BrowserProvider>
        </AudioProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
