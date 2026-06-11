import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/cx";

const buttonVariants = cva("btn", {
  variants: {
    variant: {
      default: "",
      primary: "btn-primary",
      destructive: "btn-danger",
      outline: "btn-outline",
      secondary: "btn-outline",
      ghost: "btn-ghost",
      link: "btn-ghost underline-offset-4 hover:underline",
    },
    size: {
      default: "",
      sm: "btn-sm",
      lg: "h-[44px] px-7 text-[14px]",
      icon: "btn-icon",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
