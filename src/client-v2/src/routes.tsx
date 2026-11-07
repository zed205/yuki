import { Route } from '@solidjs/router';

/**
 * Main routes for the application.
 * Currently defines a single chat view route.
 */
export function Routes() {
  return (
    <>
      <Route path="/" component={() => <main class="flex h-screen w-full bg-[#0d1117] text-[#c9d1d9]">Chat View (TBD)</main>} />
      <Route path="*" component={() => <main class="flex h-screen w-full bg-[#0d1117] text-[#c9d1d9] flex items-center justify-center"><p class="text-[#8b949e]">Page not found</p></main>} />
    </>
  );
}
