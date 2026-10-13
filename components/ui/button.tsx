import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap border text-sm font-semibold transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-pink bg-pink text-bg shadow-xs hover:-translate-x-px hover:-translate-y-px hover:shadow-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        destructive:
          "border-red bg-red text-bg shadow-xs hover:-translate-x-px hover:-translate-y-px hover:shadow-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        outline:
          "border-line bg-panel text-ink shadow-xs hover:-translate-x-px hover:-translate-y-px hover:border-pink hover:text-pink hover:shadow-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        secondary:
          "border-violet bg-secondary text-ink shadow-xs hover:-translate-x-px hover:-translate-y-px hover:shadow-sm",
        ghost: "border-transparent hover:border-line hover:bg-accent",
        link: "border-transparent text-pink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
