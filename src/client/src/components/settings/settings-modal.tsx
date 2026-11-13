'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ThemeSettings } from './theme-settings';
import { VoiceSettings } from './voice-settings';
import { AgentSettings } from './agent-settings';
import { ModelSettings } from './model-settings';

export interface SettingsModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState('theme');

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start">
            <TabsTrigger value="theme" className="flex items-center gap-2">
              🎨 Theme
            </TabsTrigger>
            <TabsTrigger value="voice" className="flex items-center gap-2">
              🎤 Voice
            </TabsTrigger>
            <TabsTrigger value="agent" className="flex items-center gap-2">
              🤖 Agent
            </TabsTrigger>
            <TabsTrigger value="model" className="flex items-center gap-2">
              ⚙️ Model
            </TabsTrigger>
          </TabsList>
          <TabsContent value="theme" className="p-2 pt-4">
            <ThemeSettings />
          </TabsContent>
          <TabsContent value="voice" className="p-2 pt-4">
            <VoiceSettings />
          </TabsContent>
          <TabsContent value="agent" className="p-2 pt-4">
            <AgentSettings />
          </TabsContent>
          <TabsContent value="model" className="p-2 pt-4">
            <ModelSettings />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
