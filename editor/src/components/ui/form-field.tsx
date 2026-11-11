import { cn } from "@/lib/cx";
import type * as React from "react";

export interface FormFieldProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Field label, rendered with the .field-label utility above the control. */
  label: React.ReactNode;
  /** The form control (input/select/textarea or ui/ primitive). */
  children: React.ReactNode;
  /** Optional hint rendered under the control. */
  hint?: React.ReactNode;
  /**
   * The control is a group of buttons (a `Segmented`): a `<div>` instead of a `<label>`, which
   * would press the first button when its text is clicked.
   */
  group?: boolean;
}

/**
 * Label + control + optional hint, wrapped in a <label> so clicking the
 * label focuses the control. Replaces the repeated
 * `<label><span className="field-label">…</span><input/></label>` pattern.
 */
function FormField({ label, hint, group, children, className, ...props }: FormFieldProps) {
  if (group)
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <span className="field-label !mb-0">{label}</span>
        {children}
        {hint != null && <span className="text-[11.5px] text-[var(--text-faint)]">{hint}</span>}
      </div>
    );
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children — wrapping <label> associates it implicitly
    <label className={cn("flex flex-col gap-1.5", className)} {...props}>
      <span className="field-label !mb-0">{label}</span>
      {children}
      {hint != null && <span className="text-[11.5px] text-[var(--text-faint)]">{hint}</span>}
    </label>
  );
}

export { FormField };
