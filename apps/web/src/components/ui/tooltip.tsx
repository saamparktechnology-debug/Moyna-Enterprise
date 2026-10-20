import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  /** Text shown on hover and keyboard focus. An optional shortcut hint follows it. */
  content: ReactNode;
  shortcut?: string;
  side?: ComponentProps<typeof TooltipPrimitive.Content>['side'];
  children: ReactNode;
}

/** Wraps one focusable child. The child keeps its own accessible name; the tooltip only adds a hint. */
export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-[60] max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md',
          )}
        >
          {content}
          {shortcut ? (
            <kbd className="ml-2 rounded bg-background/20 px-1 font-mono text-[0.7rem]">
              {shortcut}
            </kbd>
          ) : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
