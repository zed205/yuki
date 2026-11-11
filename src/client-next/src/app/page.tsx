"use client";

import { useTheme } from "@/components/theme/theme-provider";
import { useWebSocket } from "@/context/websocket-context";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { state, toggleTheme } = useTheme();
  const { isConnected, connectionState } = useWebSocket();

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Yuki</h1>
      <p className="text-muted-foreground">
        Theme: {state.activeThemeId} ({state.isDark ? "dark" : "light"}) · WS:{" "}
        {connectionState}
      </p>
      <Button onClick={toggleTheme}>Toggle theme</Button>
      {isConnected && (
        <p className="text-xs text-green-500">WebSocket connected</p>
      )}
    </main>
  );
}
