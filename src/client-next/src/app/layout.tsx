import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { WebSocketProvider } from "@/context/websocket-context";
import { ToasterProvider } from "@/components/toast/toaster-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AudioProvider } from "@/context/audio-context";
import { ProjectProvider } from "@/context/project-context";
import { SessionProvider } from "@/context/session-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans text-[13px]`}
      >
        <ThemeProvider>
          <WebSocketProvider>
            <ToasterProvider>
              <AudioProvider>
                <ProjectProvider>
                  <SessionProvider>
                    <TooltipProvider>{children}</TooltipProvider>
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
