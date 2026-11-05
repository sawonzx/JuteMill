import { forwardRef } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/utils';
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[5px] text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4b8060] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-[#285f45] bg-[#285f45] px-[11px] py-2 text-white hover:bg-[#214f3b]',
        outline:
          'border border-[#e4eae5] bg-white px-[11px] py-2 text-[#56645a] hover:bg-[#f5f7f5]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);
const Button = forwardRef(({ className, variant, type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      buttonVariants({
        variant,
      }),
      className
    )}
    {...props}
  />
));
Button.displayName = 'Button';
export { Button, buttonVariants };
