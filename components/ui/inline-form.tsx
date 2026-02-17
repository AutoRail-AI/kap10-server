import * as React from "react"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

interface InlineFormProps extends React.HTMLAttributes<HTMLFormElement> {
  children: React.ReactNode
}

const InlineForm = React.forwardRef<HTMLFormElement, InlineFormProps>(
  ({ className, ...props }, ref) => {
    return (
      <form
        ref={ref}
        className={cn("space-y-4", className)}
        {...props}
      />
    )
  }
)
InlineForm.displayName = "InlineForm"

interface InlineFormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  title?: string
  description?: string
  showSeparator?: boolean
}

const InlineFormSection = React.forwardRef<HTMLDivElement, InlineFormSectionProps>(
  ({ className, title, description, showSeparator = false, children, ...props }, ref) => {
    return (
      <>
        <div
          ref={ref}
          className={cn("space-y-4", className)}
          {...props}
        >
          {(title || description) && (
            <div className="space-y-0.5">
              {title && <h3 className="text-sm font-semibold">{title}</h3>}
              {description && (
                <p className="text-xs text-foreground opacity-85">{description}</p>
              )}
            </div>
          )}
          {children}
        </div>
        {showSeparator && <Separator />}
      </>
    )
  }
)
InlineFormSection.displayName = "InlineFormSection"

export { InlineForm, InlineFormSection }
