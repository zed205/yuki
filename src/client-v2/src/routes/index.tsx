import { Component, lazy } from 'solid-js';
import { Route } from '@solidjs/router';
import { MainLayout } from '@/components/Layout/MainLayout';
import { SettingsModal } from '@/components/Settings/SettingsModal';

// Chat home page - shows the chat panel
const Home: Component = () => {
  return (
    <div class="flex-1 overflow-hidden flex flex-col">
      {/* Chat messages will be rendered here by MainLayout */}
    </div>
  );
};

const Routes: Component = () => (
  <>
    <MainLayout>
      <Route path="/" component={Home} />
      <Route path="/settings" component={SettingsModal} />
    </MainLayout>
  </>
);

export { Routes };
