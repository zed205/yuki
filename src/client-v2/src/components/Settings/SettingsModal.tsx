import { createSignal, Show } from 'solid-js';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from '../ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ThemeSettings } from './ThemeSettings';
import { VoiceSettings } from './VoiceSettings';
import { AgentSettings } from './AgentSettings';
import { ModelSettings } from './ModelSettings';

export interface SettingsModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsModal(props: SettingsModalProps) {
  const [activeTab, setActiveTab] = createSignal('theme');

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <DialogBody class="p-0">
          <Tabs value={activeTab()} onChange={(v) => setActiveTab(v)}>
            <TabsList class="w-full justify-start border-b border-border rounded-none px-4">
              <TabsTrigger value="theme" class="flex items-center gap-2">
                🎨 Theme
              </TabsTrigger>
              <TabsTrigger value="voice" class="flex items-center gap-2">
                🎤 Voice
              </TabsTrigger>
              <TabsTrigger value="agent" class="flex items-center gap-2">
                🤖 Agent
              </TabsTrigger>
              <TabsTrigger value="model" class="flex items-center gap-2">
                ⚙️ Model
              </TabsTrigger>
            </TabsList>

            <div class="p-4">
              <TabsContent value="theme">
                <ThemeSettings />
              </TabsContent>

              <TabsContent value="voice">
                <VoiceSettings />
              </TabsContent>

              <TabsContent value="agent">
                <AgentSettings />
              </TabsContent>

              <TabsContent value="model">
                <ModelSettings />
              </TabsContent>
            </div>
          </Tabs>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
