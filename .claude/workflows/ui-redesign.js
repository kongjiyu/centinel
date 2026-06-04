export const meta = {
  name: 'ui-redesign',
  description: 'Redesign Centinel frontend with Tailwind CSS + shadcn/ui',
  phases: [
    { title: 'Foundation', detail: 'Install Tailwind + shadcn/ui + design system' },
    { title: 'Primitives', detail: 'Build base UI components and layout' },
    { title: 'Screens', detail: 'Redesign all screens in parallel' },
    { title: 'Polish', detail: 'Cleanup, animations, accessibility' },
  ],
}

const DESIGN_SYSTEM = `
## Design System
- Colors: slate base, blue-600 primary, emerald-500 success, amber-500 warning, red-500 danger
- Dark-first: bg-zinc-950 (app bg), bg-zinc-900 (surfaces), bg-zinc-800 (cards)
- Typography: Inter font, text-sm base
- Icons: lucide-react
- Components: shadcn/ui pattern (Radix-based, copy-pasted, owned)
- Spacing: 4px grid (p-2, p-3, p-4, p-6)
`

async function main({ agent, parallel, phase, log }) {
  // ── Phase 1: Foundation ──────────────────────────────────────────────────
  phase('Foundation')
  log('Installing Tailwind CSS + shadcn/ui dependencies...')

  await agent(`
You are setting up Tailwind CSS + shadcn/ui for a Tauri v1 + React 18 desktop app at centinel/.

## Step 1: Install dependencies
cd centinel && pnpm add tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-separator @radix-ui/react-scroll-area @radix-ui/react-label @radix-ui/react-switch @radix-ui/react-checkbox && pnpm add -D @types/node

## Step 2: Create centinel/tailwind.config.ts
\`\`\`ts
import type { Config } from 'tailwindcss'
const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', border: 'hsl(var(--sidebar-border))' },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
    },
  },
  plugins: [],
}
export default config
\`\`\`

## Step 3: Create centinel/postcss.config.js
\`\`\`js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
\`\`\`

## Step 4: Create centinel/src/globals.css
Create a comprehensive globals.css with:
- @import "tailwindcss" (Tailwind v4 syntax with @tailwindcss/vite plugin)
- @custom-variant dark (&:is(.dark *))
- @theme block with all CSS custom properties for light and dark themes
- @layer base reset rules for border-border

Light theme CSS variables (on :root):
  --background: 0 0% 100%; --foreground: 240 10% 3.9%;
  --card: 0 0% 100%; --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%; --popover-foreground: 240 10% 3.9%;
  --primary: 221.2 83.2% 53.3%; --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%; --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96.1%; --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%; --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%; --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%; --input: 214.3 31.8% 91.4%;
  --ring: 221.2 83.2% 53.3%; --radius: 0.75rem;
  --sidebar: 0 0% 98%; --sidebar-foreground: 240 5.3% 26.1%;
  --sidebar-border: 220 13% 91%;

Dark theme (.dark class):
  --background: 240 10% 3.9%; --foreground: 0 0% 98%;
  --card: 240 10% 3.9%; --card-foreground: 0 0% 98%;
  --popover: 240 10% 3.9%; --popover-foreground: 0 0% 98%;
  --primary: 217.2 91.2% 59.8%; --primary-foreground: 222.2 47.4% 11.2%;
  --secondary: 240 3.7% 15.9%; --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%; --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%; --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%; --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%; --input: 240 3.7% 15.9%;
  --ring: 224.3 76.3% 48%; --radius: 0.75rem;
  --sidebar: 240 5.9% 10%; --sidebar-foreground: 240 4.8% 95.9%;
  --sidebar-border: 240 3.7% 15.9%;

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; font-family: 'Inter', system-ui, sans-serif; }
}

## Step 5: Create centinel/src/lib/utils.ts
\`\`\`ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
\`\`\`

## Step 6: Update centinel/vite.config.ts to use @tailwindcss/vite plugin:
\`\`\`ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { strictPort: true, port: 1420 },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
\`\`\`

## Step 7: Update centinel/index.html title to "Centinel — AI Quality Assurance"

## Step 8: Update centinel/src/main.tsx to import "./globals.css" instead of "./style.css"

Do NOT delete App.css or style.css yet. Just add the new files and update imports.

After all steps, run: cd centinel && pnpm build
Fix any errors. The build MUST succeed.
`, { label: 'foundation', phase: 'Foundation' })

  // ── Phase 2: Primitives ──────────────────────────────────────────────────
  phase('Primitives')
  log('Building UI primitives and layout components...')

  const uiComponents = [
    {
      name: 'button',
      code: `import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
`
    },
    {
      name: 'badge',
      code: `import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        critical: "border-red-500/20 bg-red-500/10 text-red-500",
        high: "border-orange-500/20 bg-orange-500/10 text-orange-500",
        medium: "border-yellow-500/20 bg-yellow-500/10 text-yellow-600",
        low: "border-blue-500/20 bg-blue-500/10 text-blue-500",
        info: "border-zinc-500/20 bg-zinc-500/10 text-zinc-500",
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-500",
        warning: "border-amber-500/20 bg-amber-500/10 text-amber-500",
        error: "border-red-500/20 bg-red-500/10 text-red-500",
        running: "border-blue-500/20 bg-blue-500/10 text-blue-500 animate-pulse",
        queued: "border-zinc-500/20 bg-zinc-500/10 text-zinc-500",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
`
    },
    {
      name: 'card',
      code: `import * as React from "react"
import { cn } from "../../lib/utils"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border bg-card text-card-foreground shadow-sm", className)} {...props} />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  )
)
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
)
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
)
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
`
    },
    {
      name: 'input',
      code: `import * as React from "react"
import { cn } from "../../lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
`
    },
    {
      name: 'textarea',
      code: `import * as React from "react"
import { cn } from "../../lib/utils"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
`
    },
    {
      name: 'select',
      code: `import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "../../lib/utils"

const Select = SelectPrimitive.Root
const SelectGroup = SelectPrimitive.Group
const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn("p-1", position === "popper" && "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator }
`
    },
    {
      name: 'dialog',
      code: `import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "../../lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
`
    },
    {
      name: 'tabs',
      code: `import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "../../lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground", className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
`
    },
    {
      name: 'tooltip',
      code: `import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "../../lib/utils"

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
`
    },
    {
      name: 'separator',
      code: `import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"
import { cn } from "../../lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
      className
    )}
    {...props}
  />
))
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
`
    },
    {
      name: 'scroll-area',
      code: `import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { cn } from "../../lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
`
    },
    {
      name: 'switch',
      code: `import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "../../lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
`
    },
    {
      name: 'label',
      code: `import * as React from "react"
import * as LabelPrimitive from "@radix-ui/react-label"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70")

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
`
    },
  ]

  // Write all UI components in parallel
  await parallel(
    uiComponents.map(comp => () => agent(
      `Write the file centinel/src/components/ui/${comp.name}.tsx with this exact content. Create the directory if it doesn't exist.\n\nFile content:\n${comp.code}\n\nAfter writing, verify it compiles: cd centinel && pnpm build`,
      { label: `ui:${comp.name}`, phase: 'Primitives' }
    ))
  )

  // Layout components + AppShell
  log('Building layout components and AppShell...')

  await parallel([
    () => agent(`
Create centinel/src/components/PageHeader.tsx:

\`\`\`tsx
import React from "react"
import { cn } from "../lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-6", className)}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
\`\`\`
`, { label: 'layout:PageHeader', phase: 'Primitives' }),

    () => agent(`
Create centinel/src/components/EmptyState.tsx:

\`\`\`tsx
import React from "react"
import { type LucideIcon } from "lucide-react"
import { Button } from "./ui/button"
import { cn } from "../lib/utils"

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <Icon className="h-12 w-12 text-muted-foreground/50" />
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">{description}</p>
      {action && (
        <Button onClick={action.onClick} className="mt-4">
          {action.label}
        </Button>
      )}
    </div>
  )
}
\`\`\`
`, { label: 'layout:EmptyState', phase: 'Primitives' }),

    () => agent(`
Create centinel/src/components/LoadingScreen.tsx:

\`\`\`tsx
import { Loader2 } from "lucide-react"
import { cn } from "../lib/utils"

interface LoadingScreenProps {
  message?: string
  className?: string
}

export function LoadingScreen({ message = "Loading...", className }: LoadingScreenProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center h-full w-full", className)}>
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
\`\`\`
`, { label: 'layout:LoadingScreen', phase: 'Primitives' }),
  ])

  // AppShell redesign
  log('Redesigning AppShell...')
  await agent(`
${DESIGN_SYSTEM}

Redesign centinel/src/components/AppShell.tsx with a modern sidebar layout.

Import icons from lucide-react: LayoutDashboard, FolderOpen, Settings, Shield, Wifi, WifiOff, CheckCircle2, XCircle, Sun, Moon.
Import cn from ../lib/utils.
Import the Screen type from ../types.
Import AiProviderSetting from ../types.

Props:
- screen: Screen
- onNavigate: (screen: Screen) => void
- aiSettings: AiProviderSetting[]
- sidecarOnline: boolean
- children: React.ReactNode

New design:

\`\`\`tsx
import { useState, useEffect } from 'react'
import { LayoutDashboard, FolderOpen, Settings, Shield, Wifi, WifiOff, CheckCircle2, XCircle, Sun, Moon } from 'lucide-react'
import { cn } from '../lib/utils'
import type { Screen, AiProviderSetting } from '../types'

interface AppShellProps {
  screen: Screen
  onNavigate: (screen: Screen) => void
  aiSettings: AiProviderSetting[]
  sidecarOnline: boolean
  children: React.ReactNode
}

export function AppShell({ screen, onNavigate, aiSettings, sidecarOnline, children }: AppShellProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('centinel-theme') as 'light' | 'dark') || 'dark'
    }
    return 'dark'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('centinel-theme', theme)
  }, [theme])

  const navItems = [
    { name: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
    { name: 'projects' as const, label: 'Projects', icon: FolderOpen },
    { name: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  const textAi = aiSettings.find(s => s.id === 'text')
  const visionAi = aiSettings.find(s => s.id === 'vision')

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-56 bg-zinc-900 text-zinc-100 flex flex-col z-40">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-14 border-b border-zinc-800">
          <Shield className="h-6 w-6 text-blue-500" />
          <span className="text-lg font-bold">Centinel</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col gap-1 px-3 py-4">
          {navItems.map(item => {
            const isActive = screen.name === item.name || (item.name === 'projects' && (screen.name === 'project-detail' || screen.name === 'dynamic-session' || screen.name === 'static-session'))
            return (
              <button
                key={item.name}
                onClick={() => onNavigate({ name: item.name } as Screen)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-3 py-3 space-y-2">
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 transition-colors w-full"
          >
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          {/* Connection status */}
          <div className="flex items-center gap-2 px-3 text-xs">
            {sidecarOnline ? (
              <><div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /><span className="text-zinc-400">Online</span></>
            ) : (
              <><div className="h-1.5 w-1.5 rounded-full bg-red-500" /><span className="text-zinc-400">Offline</span></>
            )}
          </div>

          {/* AI status */}
          <div className="px-3 space-y-1">
            <div className="flex items-center gap-2 text-xs">
              {textAi?.hasApiKey ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
              <span className="text-zinc-400">Text AI</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {visionAi?.hasApiKey ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-red-500" />}
              <span className="text-zinc-400">Vision AI</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-56 flex-1 overflow-auto bg-zinc-50 dark:bg-zinc-950">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
\`\`\`

Write this file, replacing the current AppShell.tsx entirely.
`, { label: 'layout:AppShell', phase: 'Primitives' })
}

// ── Phase 3: Screens ──────────────────────────────────────────────────────
async function screens({ agent, parallel, phase, log }) {
  phase('Screens')
  log('Redesigning all screens in parallel...')

  const screenPrompts = [
    {
      label: 'screen:Dashboard',
      prompt: `${DESIGN_SYSTEM}
Redesign centinel/src/screens/DashboardScreen.tsx with a modern dashboard layout.

Import: Card, CardHeader, CardContent, CardTitle from ../components/ui/card
Import: Button from ../components/ui/button
Import: Badge from ../components/ui/badge
Import: PageHeader from ../components/PageHeader
Import: EmptyState from ../components/EmptyState
Import: { FolderOpen, LayoutDashboard, CheckCircle2, XCircle, ArrowRight, Play, Settings as SettingsIcon } from lucide-react
Import: cn from ../lib/utils
Import types: Project, AiProviderSetting, Screen from ../types

Props: { projects: Project[], aiSettings: AiProviderSetting[], onNavigate: (screen: Screen) => void }

Layout:
- PageHeader title="Dashboard" description="Overview of your QA projects and activity"
- Stats row: grid grid-cols-3 gap-4 mb-6
  - Card 1: FolderOpen icon + projects.length + "Total Projects"
  - Card 2: textAi.hasApiKey ? CheckCircle2 green : XCircle red + "Text AI" + status
  - Card 3: visionAi.hasApiKey ? CheckCircle2 green : XCircle red + "Vision AI" + status
  Each card: Card > CardHeader (flex items-center gap-2 text-sm text-muted-foreground) > CardContent (text-3xl font-bold)
- Recent Projects: "Recent Projects" heading + Card
  - Empty: EmptyState with FolderOpen
  - List: divide-y, max 5, each row hover:bg-muted/50 cursor-pointer → onNavigate({name:'project-detail', projectId:p.id})
- Quick Actions: grid grid-cols-2 gap-4 mt-6
  - Card with Play icon + "New Project" button → onNavigate({name:'projects'})
  - Card with SettingsIcon + "Go to Settings" button → onNavigate({name:'settings'})

Write the complete file.`
    },
    {
      label: 'screen:Projects',
      prompt: `${DESIGN_SYSTEM}
Redesign centinel/src/screens/ProjectsScreen.tsx.

Import: Card, CardHeader, CardContent from ../components/ui/card
Import: Button from ../components/ui/button
Import: Input from ../components/ui/input
Import: Textarea from ../components/ui/textarea
Import: Label from ../components/ui/label
Import: Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger from ../components/ui/dialog
Import: PageHeader from ../components/PageHeader
Import: EmptyState from ../components/EmptyState
Import: { FolderOpen, Plus, Trash2, ChevronRight } from lucide-react
Import: cn from ../lib/utils
Import types: Project, Screen from ../types
Import: open from @tauri-apps/api/dialog

Props: { projects: Project[], onNavigate: (screen: Screen) => void, onCreate: (name: string, description: string, workspacePath: string) => Promise<void>, onDelete: (id: string) => Promise<void> }

State: dialogOpen, name, description, workspacePath, creating

Layout:
- PageHeader title="Projects" description="Manage your QA projects"
  - Actions: Dialog with DialogTrigger as Button with Plus icon "New Project"
- DialogContent max-w-md:
  - DialogHeader: "Create Project" + "Set up a new QA project"
  - Form: Label+Input name, Label+Textarea description, Label+div(Input readonly + Button "Browse..." for folder picker)
  - DialogFooter: Button ghost "Cancel" + Button primary "Create Project" disabled if invalid
- Project list:
  - Empty: EmptyState FolderOpen "No projects yet"
  - List: Card divide-y, each row: group flex items-center justify-between py-4 px-6 hover:bg-muted/50
    - Left: FolderOpen + name (font-medium) + description (text-sm text-muted-foreground truncate max-w-xs)
    - Right: text-xs text-muted-foreground date + Button ghost Trash2 opacity-0 group-hover:opacity-100 + ChevronRight
    - onClick: onNavigate({name:'project-detail', projectId:p.id})
    - Delete: window.confirm first

Write the complete file.`
    },
    {
      label: 'screen:ProjectDetail',
      prompt: `${DESIGN_SYSTEM}
Redesign centinel/src/screens/ProjectDetailScreen.tsx.

Import: Tabs, TabsList, TabsTrigger, TabsContent from ../components/ui/tabs
Import: Card, CardHeader, CardContent, CardTitle from ../components/ui/card
Import: Button from ../components/ui/button
Import: Badge from ../components/ui/badge
Import: PageHeader from ../components/PageHeader
Import: ArtifactsPanel from ../components/ArtifactsPanel
Import: StaticReviewForm from ../components/StaticReviewForm
Import: FindingsPanel from ../components/FindingsPanel
Import: { ArrowLeft, Download, FileText, ClipboardCheck, Play, AlertTriangle, Loader2, Clock } from lucide-react
Import: cn from ../lib/utils
Import: api from ../api/client
Import types: Project, Screen, StaticSession from ../types

Props: { project: Project, onNavigate: (screen: Screen) => void }

State: staticSessions, dynamicSessions, creating session, activeTab

Layout:
- PageHeader title=project.name description=project.description
  - Actions: Button outline Download "Export Report" + Button ghost ArrowLeft "Back"
- Tabs default="overview":
  - TabsList: Overview | Artifacts | Static Review | Dynamic Testing | Findings
  - Overview tab:
    - grid grid-cols-4 gap-4: 4 stat cards (FileText/ClipboardCheck/Play/AlertTriangle icons + counts)
    - "Recent Activity" Card combining last sessions
  - Artifacts tab: <ArtifactsPanel projectId={project.id} />
  - Static Review tab:
    - Collapsible StaticReviewForm (toggle with Button)
    - Session list Card: each row clickable → onNavigate({name:'static-session', projectId, sessionId})
    - Status badges, Loader2 animate-spin for running
  - Dynamic Testing tab:
    - Similar: DynamicTestForm toggle + session list
    - Each row → onNavigate({name:'dynamic-session', projectId, sessionId})
  - Findings tab: <FindingsPanel projectId={project.id} />

Poll staticSessions + dynamicSessions every 2s when any session is running/queued.

Write the complete file.`
    },
    {
      label: 'screen:StaticSession',
      prompt: `${DESIGN_SYSTEM}
Redesign centinel/src/screens/StaticSessionScreen.tsx.

Import: Card, CardHeader, CardContent from ../components/ui/card
Import: Button from ../components/ui/button
Import: Badge from ../components/ui/badge
Import: PageHeader from ../components/PageHeader
Import: EmptyState from ../components/EmptyState
Import: { ArrowLeft, Download, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, AlertTriangle, Check, X, Clock, Ban } from lucide-react
Import: cn from ../lib/utils
Import: api from ../api/client
Import types: StaticSession, Finding, Screen from ../types

Props: { projectId: string, sessionId: string, onNavigate: (screen: Screen) => void }

State: session, findings, expanded set, loading

REVIEW_TYPE_LABELS: { requirement_review: 'Requirement Review', code_review: 'Code Inspection', requirement_to_code_traceability: 'Traceability Analysis', cross_artifact_consistency: 'Consistency Check' }

Layout:
- PageHeader title=session.name description=REVIEW_TYPE_LABELS[session.reviewType]
  - Actions: Cancel (destructive, if running/queued), Export Report (outline, if success), Back (ghost)
- Session Info Card: grid grid-cols-2 gap-4
  - Review Type: Badge variant=secondary
  - Status: Badge with status variant (running/queued/success/failure/cancelled)
  - Created + Updated dates
  - Summary (if success, full width)
  - Failure reason (if failure, text-destructive full width)
- Findings section:
  - Header: "Findings" + Badge count
  - Empty: EmptyState CheckCircle2 "No issues found"
  - List: Card divide-y, sorted by severity (critical→high→medium→low→info)
    - Each: expandable row
      - Header: severity Badge + title (font-medium) + category Badge secondary + confidence Badge outline + ChevronDown/Right toggle
      - Expanded: space-y-3 bg-muted/30 rounded-b-lg p-4
        - Description paragraph
        - Evidence: pre bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto
        - Recommendation: text-sm
        - Actions for "new" status: Button primary "Accept" + Button ghost "Dismiss"

Poll every 2s while running/queued. Use useEffect with setInterval.

Write the complete file.`
    },
    {
      label: 'screen:DynamicSession',
      prompt: `${DESIGN_SYSTEM}
Redesign centinel/src/screens/DynamicSessionScreen.tsx.

Import: Card, CardHeader, CardContent from ../components/ui/card
Import: Button from ../components/ui/button
Import: Badge from ../components/ui/badge
Import: PageHeader from ../components/PageHeader
Import: EmptyState from ../components/EmptyState
Import: { ArrowLeft, ExternalLink, Loader2, CheckCircle2, XCircle, Play, Target, Clock, Image as ImageIcon } from lucide-react
Import: cn from ../lib/utils
Import: api from ../api/client
Import types: DynamicSession, DynamicEvidence, Screen from ../types

Props: { projectId: string, sessionId: string, onNavigate: (screen: Screen) => void }

State: session, evidence, loading

Layout:
- PageHeader title="Dynamic Test Session" description=session.goal truncated
  - Actions: Cancel (destructive, if running), Back (ghost)
- Session Info Card: grid grid-cols-3 gap-4
  - Target URL: ExternalLink + a[target=_blank] href
  - Mission Type: Badge
  - Max Steps: number
  - Status: Badge with status variant
  - Start Time: formatted date
- Summary Card (success/failure): CheckCircle2/XCircle icon + summary text
- Screenshots Gallery:
  - Header: "Screenshots" + Badge count
  - Empty: EmptyState ImageIcon
  - Grid: grid-cols-2 md:grid-cols-3 gap-4
    - Each: Card overflow-hidden group
      - img src={asset://localhost/${screenshotPath}} className="w-full aspect-video object-cover"
      - Hover overlay: absolute inset-0 bg-black/50
- Action Trace Card: pre bg-muted rounded-lg p-4 text-xs font-mono overflow-x-auto

Poll every 2s while running/queued.

Write the complete file.`
    },
    {
      label: 'screen:Settings',
      prompt: `${DESIGN_SYSTEM}
Redesign centinel/src/screens/SettingsScreen.tsx.

Import: Card, CardHeader, CardContent, CardTitle, CardDescription, CardFooter from ../components/ui/card
Import: Button from ../components/ui/button
Import: Input from ../components/ui/input
Import: Label from ../components/ui/label
Import: Select, SelectTrigger, SelectValue, SelectContent, SelectItem from ../components/ui/select
Import: PageHeader from ../components/PageHeader
Import: { Brain, Eye, Zap, CheckCircle2, XCircle, EyeOff, Loader2, Save } from lucide-react
Import: cn from ../lib/utils
Import: api from ../api/client
Import types: AiProviderSetting from ../types

Props: { settings: AiProviderSetting[], onRefresh: () => Promise<void> }

Local state for each provider: form data (compatibilityMode, apiKey, baseUrl, model), saving, testing, testResult, showApiKey

Layout:
- PageHeader title="Settings" description="Configure AI providers and system preferences"
- Section: "AI Providers"
- grid grid-cols-2 gap-6:
  For each provider (text, vision):
    - Card:
      - CardHeader: icon (Brain for text, Eye for vision) + CardTitle + CardDescription
      - CardContent space-y-4:
        - Label "Compatibility Mode" + Select (Anthropic/OpenAI)
        - Label "API Key" + div flex gap-2: Input type={showApiKey ? "text" : "password"} + Button ghost onClick toggle showApiKey (Eye/EyeOff)
        - Label "Base URL" + Input placeholder
        - Label "Model" + Input placeholder
      - CardFooter flex justify-between:
        - Button outline Zap "Test Connection" (shows Loader2 while testing, result inline below)
        - Button primary Save "Save" (shows CheckCircle2 on success)
      - Test result: if success → emerald text + CheckCircle2, if error → red text + XCircle + message

Initialize form from settings prop. Track dirty state. Save calls api.updateAiSetting. Test calls api.testAiSetting.

Write the complete file.`
    },
  ]

  await parallel(
    screenPrompts.map(s => () => agent(s.prompt, { label: s.label, phase: 'Screens', isolation: 'worktree' }))
  )
}

// ── Phase 4: Polish ───────────────────────────────────────────────────────
async function polish({ agent, parallel, phase, log }) {
  phase('Polish')
  log('Cleanup and polish...')

  await parallel([
    () => agent(`
Clean up old CSS files in centinel/:
1. Delete centinel/src/App.css
2. Delete centinel/src/style.css
3. In centinel/src/App.tsx: remove the line \`import './App.css'\`
4. Verify centinel/src/main.tsx imports './globals.css'
5. Update centinel/index.html: set <title>Centinel — AI Quality Assurance</title>
6. Run: cd centinel && pnpm build — fix any errors
`, { label: 'cleanup:css', phase: 'Polish' }),

    () => agent(`
Add animations to centinel/src/globals.css (append to the file, don't overwrite existing content):

Add these keyframes and utility classes:

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in { animation: fadeIn 0.2s ease-out; }
.animate-slide-up { animation: slideUp 0.3s ease-out; }
.animate-slide-down { animation: slideDown 0.3s ease-out; }

Also add smooth scrollbar styling:
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground)); }

And add a subtle page transition to main content:
In the AppShell main content div, add className "animate-fade-in".

Read centinel/src/components/AppShell.tsx first to find the right div to add the class to.
`, { label: 'polish:animations', phase: 'Polish' }),

    () => agent(`
Audit accessibility in all centinel/src/components/ and centinel/src/screens/ files:

1. Read each .tsx file
2. Fix:
   - Icon-only buttons: add aria-label
   - Images: add alt attributes
   - Form inputs: ensure associated Label elements
   - Interactive divs: add role="button" tabIndex={0} onKeyDown handlers
   - Ensure focus-visible:ring-2 styles are present on interactive elements
3. Don't change functionality, only add a11y attributes

Files to check:
- components/AppShell.tsx
- components/ArtifactsPanel.tsx
- components/FindingsPanel.tsx
- components/StaticReviewForm.tsx
- components/PageHeader.tsx
- components/EmptyState.tsx
- screens/DashboardScreen.tsx
- screens/ProjectsScreen.tsx
- screens/ProjectDetailScreen.tsx
- screens/StaticSessionScreen.tsx
- screens/DynamicSessionScreen.tsx
- screens/SettingsScreen.tsx
`, { label: 'polish:a11y', phase: 'Polish' }),
  ])

  // Final build verification
  log('Final build verification...')
  await agent(`
Run final build verification:
1. cd centinel && pnpm build
2. If there are TypeScript errors, read the error messages and fix the source files
3. If there are missing imports, add them
4. If there are missing component files, check if they exist in components/ui/
5. The build MUST succeed with zero errors

Common issues to check:
- Missing cn import from ../lib/utils
- Missing component imports from ../components/ui/*
- Type mismatches in props
- Unused imports
`, { label: 'verify:build', phase: 'Polish' })
}

// ── Entry Point ───────────────────────────────────────────────────────────
export default async function run({ agent, parallel, phase, log, args, budget }) {
  phase('Foundation')
  await phase1_Foundation({ agent, parallel, phase, log, args, budget })

  phase('Primitives')
  await primitives({ agent, parallel, phase, log, args, budget })

  phase('Screens')
  await screens({ agent, parallel, phase, log, args, budget })

  phase('Polish')
  await polish({ agent, parallel, phase, log, args, budget })

  log('UI redesign complete! Run cd centinel && pnpm tauri dev to preview.')
  return { status: 'success' }
}
