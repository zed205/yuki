import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { WebSocketProvider } from "@/context/websocket-context";
import { ToasterProvider } from "@/components/toast/toaster-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AudioProvider } from "@/context/audio-context";
import { ProjectProvider } from "@/context/project-context";
import { SessionProvider } from "@/context/session-context";
import { BrowserProvider } from "@/context/browser-context";

export const metadata: Metadata = {
  title: "Yuki",
  description: "Yuki — local LLM agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <WebSocketProvider>
            <ToasterProvider>
              <AudioProvider>
                <ProjectProvider>
                  <SessionProvider>
                    <BrowserProvider>
                      <TooltipProvider>{children}</TooltipProvider>
                    </BrowserProvider>
                  </SessionProvider>
                </ProjectProvider>
              </AudioProvider>
            </ToasterProvider>
          </WebSocketProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
