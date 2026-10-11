import { Link, type LinkProps } from "@tanstack/react-router";
import { buttonClass, type Variant } from "./styles";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/* ---------------------------------------------------------------- buttons */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a spinner, disables the button and says so to assistive technology. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

/** A link that looks like a button. */
export function LinkButton({
  variant = "primary",
  className,
  ...rest
}: LinkProps & { variant?: Variant; className?: string; children?: ReactNode }) {
  return <Link className={buttonClass(variant, className)} {...rest} />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span
      role={label === undefined ? undefined : "status"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

/* ----------------------------------------------------------------- fields */

const FIELD_CONTROL =
  "min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted disabled:opacity-60 aria-[invalid=true]:border-danger";

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string | undefined;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  const ids = [hint !== undefined && `${id}-hint`, error !== undefined && `${id}-error`].filter(
    Boolean,
  );
  return ids.length === 0 ? undefined : ids.join(" ");
}

export const TextField = forwardRef<
  HTMLInputElement,
  FieldShellProps & InputHTMLAttributes<HTMLInputElement>
>(function TextField({ label, hint, error, className, ...rest }, ref) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <input
        ref={ref}
        id={id}
        className={FIELD_CONTROL}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  FieldShellProps & TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextAreaField({ label, hint, error, className, ...rest }, ref) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <textarea
        ref={ref}
        id={id}
        rows={3}
        className={cx(FIELD_CONTROL, "py-2")}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  FieldShellProps & SelectHTMLAttributes<HTMLSelectElement>
>(function SelectField({ label, hint, error, className, children, ...rest }, ref) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}>
      <select
        ref={ref}
        id={id}
        className={FIELD_CONTROL}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export const CheckboxField = forwardRef<
  HTMLInputElement,
  { label: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>
>(function CheckboxField({ label, hint, className, ...rest }, ref) {
  const id = useId();
  return (
    <div className={cx("flex items-start gap-3", className)}>
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className="mt-1 size-5 shrink-0 accent-[var(--accent)]"
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        {...rest}
      />
      <div className="flex flex-col">
        <label htmlFor={id} className="min-h-6 text-sm font-medium">
          {label}
        </label>
        {hint !== undefined && (
          <p id={`${id}-hint`} className="text-xs text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------- content and state */

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "li" | "article";
}) {
  return (
    <Tag className={cx("rounded-2xl border border-line bg-surface p-4", className)}>{children}</Tag>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "strong";
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "strong" ? "bg-accent text-accent-fg" : "border border-line text-muted",
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "error",
  children,
  className,
}: {
  tone?: "error" | "info";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-danger bg-danger-bg text-danger"
          : "border-line bg-surface-2 text-fg",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-base font-semibold">{title}</p>
      {children !== undefined && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action}
    </div>
  );
}

/** Shown while a query loads. A spinner and a label for assistive technology. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted">
      <Spinner label={label} />
      <span aria-hidden="true">{label}…</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger bg-danger-bg px-6 py-8 text-center">
      <p role="alert" className="text-sm font-medium text-danger">
        {message}
      </p>
      {onRetry !== undefined && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {subtitle !== undefined && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- dialogs */

/**
 * A modal built on the native <dialog>: the browser traps focus inside it, returns focus on close and
 * closes it on Escape. `onClose` runs for Escape, the close button and the backdrop.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (the dialog element itself, outside its content) closes it.
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <div className="text-sm">{children}</div>
          {footer !== undefined && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** Every destructive action asks for confirmation (SPEC section 6). */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  danger = true,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
