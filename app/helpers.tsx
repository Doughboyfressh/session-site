'use client';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
export async function action(
  body: any,
  options: { signal?: AbortSignal } = {},
) {
  const r = await fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const j = (await r.json()) as any;
  if (!r.ok)
    throw Object.assign(new Error(j.error || 'Could not save.'), {
      status: r.status,
    });
  return j;
}
export async function stripeAction(body: any): Promise<{ url: string }> {
  const r = await fetch('/api/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as any;
  if (!r.ok)
    throw Object.assign(new Error(j.error || 'Payments are unavailable.'), {
      status: r.status,
    });
  return j;
}
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return (
    '$' +
    (Number.isInteger(dollars)
      ? dollars.toLocaleString('en-US')
      : dollars.toLocaleString('en-US', { minimumFractionDigits: 2 }))
  );
}

export async function upload(
  file: File,
  purpose = 'audio',
  options: {
    signal?: AbortSignal;
    projectId?: string;
    bankId?: string;
    takeId?: string;
  } = {},
) {
  if (process.env.NEXT_PUBLIC_DEPLOYMENT_TARGET === 'vercel') {
    const send = async (body: Record<string, unknown>, signal?: AbortSignal) => {
      const response = await fetch('/api/upload-session', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
      const result = await response.json() as any;
      if (!response.ok) throw new Error(result.error || 'Upload failed.');
      return result;
    };
    const session = await send({ operation: 'start', name: file.name, size: file.size, purpose,
      projectId: options.projectId, bankId: options.bankId, takeId: options.takeId }, options.signal);
    try {
      for (let part = 0; part < session.parts; part++) {
        const response = await fetch(`/api/upload-session?id=${session.id}&part=${part}`, { method: 'PUT',
          body: file.slice(part * session.chunkSize, (part + 1) * session.chunkSize), signal: options.signal });
        if (!response.ok) { const result = await response.json() as any; throw new Error(result.error || 'Upload failed.'); }
      }
      return await send({ operation: 'complete', id: session.id }, options.signal);
    } catch (error) {
      await send({ operation: 'cancel', id: session.id }).catch(() => {});
      throw error;
    }
  }
  const fd = new FormData();
  fd.set('file', file);
  fd.set('purpose', purpose);
  if (options.projectId) fd.set('projectId', options.projectId);
  if (options.bankId) fd.set('bankId', options.bankId);
  if (options.takeId) fd.set('takeId', options.takeId);
  const r = await fetch('/api/upload', {
    method: 'POST',
    body: fd,
    signal: options.signal,
  });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(j.error || 'Upload failed.');
  return j;
}
export function Pick({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(v) => onChange(String(v))}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>
            {options
              .map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
              .find((o) => o.value === value)?.label || value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem
              key={typeof o === 'string' ? o : o.value}
              value={typeof o === 'string' ? o : o.value}
            >
              {typeof o === 'string' ? o : o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
export function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="range">
      <span>{label}</span>
      <Slider
        aria-label={label}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </label>
  );
}
export function Avatar({
  profile,
  size = 42,
}: {
  profile: any;
  size?: number;
}) {
  return profile?.avatar ? (
    <img
      className="avatar"
      style={{ width: size, height: size }}
      src={'/api/file/' + profile.avatar}
      alt={profile.name + ' profile'}
    />
  ) : (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {profile?.name?.[0] || 'S'}
    </span>
  );
}
export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Delete',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Keep it</AlertDialogCancel>
          <button
            className="button danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
