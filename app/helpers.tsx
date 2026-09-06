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
export async function upload(
  file: File,
  purpose = 'audio',
  options: { signal?: AbortSignal; projectId?: string } = {},
) {
  const fd = new FormData();
  fd.set('file', file);
  fd.set('purpose', purpose);
  if (options.projectId) fd.set('projectId', options.projectId);
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string })[];
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <Select value={value} onValueChange={(v) => onChange(String(v))}>
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
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="range">
      <span>{label}</span>
      <Slider
        aria-label={label}
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
