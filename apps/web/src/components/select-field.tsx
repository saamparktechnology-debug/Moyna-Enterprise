import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { controlClasses } from '@/components/ui/input';

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(controlClasses, 'pr-8', className)} {...props}>
      {children}
    </select>
  );
}
