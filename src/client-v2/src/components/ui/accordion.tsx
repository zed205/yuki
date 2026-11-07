import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { Show } from "solid-js";
import { cn } from '@/lib/utils';

const Accordion = AccordionPrimitive.Root;

const AccordionItem = (props: AccordionPrimitive.AccordionItemProps) => (
  <AccordionPrimitive.Item {...props} class="border-b" />
);

const AccordionTrigger = (props: AccordionPrimitive.AccordionTriggerProps) => (
  <AccordionPrimitive.Header class="flex">
    <AccordionPrimitive.Trigger
      {...props}
      class="flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180"
    >
      <slot />
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
          "data-[state=open]:rotate-180"
        )}
      >
        <path d="m6 9 6 6 6-6"/>
      </svg>
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
);

const AccordionContent = (props: AccordionPrimitive.AccordionContentProps) => (
  <AccordionPrimitive.Content
    {...props}
    class="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
  >
    <div class="pb-4 pt-0">
      <slot />
    </div>
  </AccordionPrimitive.Content>
);

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
