import { type Component, type ComponentProps, For, splitProps } from 'solid-js';
import { cn } from '../../lib/utils';

// =============================================================================
// Tabs primitives — shadcn/ui style Tabs (controlled)
// =============================================================================

export interface TabsContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tabs: string[];
}

export interface TabsProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  class?: string;
}

export interface TabsContentProps {
  value: string;
  class?: string;
}

export interface TabsListProps extends ComponentProps<'div'> {}
export interface TabsTriggerProps {
  value: string;
  class?: string;
}

// =============================================================================
// Tabs - Container
// =============================================================================

const Tabs: Component<TabsProps> = (props) => {
  return (
    <div class={cn('w-full', props.class)}>
      <TabsList
        class="flex h-10 items-center rounded-md border border-border bg-muted p-1 mb-4 gap-1"
      >
        <For each={['General', 'Voice', 'Agent', 'Model', 'Theme']}>
          {(label) => (
            <TabsTrigger
              value={label}
              onClick={() => props.onTabChange(label)}
              class={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5',
                'text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'cursor-pointer select-none',
                props.activeTab === label
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </TabsTrigger>
          )}
        </For>
      </TabsList>
      <For each={[...props.children as any[]]}>
        {(child) => {
          const childProps = child?.props as any;
          if (!childProps) return null;
          return childProps.value === props.activeTab ? child : null;
        }}
      </For>
    </div>
  );
};

// =============================================================================
// TabsList - Tab button row
// =============================================================================

const TabsList: Component<TabsListProps> = (props) => {
  const [rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('flex h-10 items-center rounded-md border border-border bg-muted p-1', rest.class)}
      role="tablist"
      {...rest}
    >
      {rest.children}
    </div>
  );
};

// =============================================================================
// TabsTrigger - Individual tab trigger
// =============================================================================

const TabsTrigger: Component<TabsTriggerProps> = (props) => {
  const [rest] = splitProps(props, ['class', 'children']);

  return (
    <button
      role="tab"
      aria-selected={false}
      class={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium',
        'ring-offset-background transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'cursor-pointer select-none',
        rest.class,
      )}
      {...rest}
    />
  );
};

// =============================================================================
// TabsContent - Tab content panel
// =============================================================================

const TabsContent: Component<TabsContentProps & ComponentProps<'div'>> = (props) => {
  const [rest] = splitProps(props, ['class', 'value', 'children']);

  return (
    <div
      role="tabpanel"
      aria-hidden={props.value !== undefined}
      class={cn('mt-2', rest.class)}
      {...rest}
    >
      {rest.children}
    </div>
  );
};

export { Tabs, TabsList, TabsTrigger, TabsContent };
