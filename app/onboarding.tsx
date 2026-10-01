'use client';
import { useState } from 'react';
import {
  AudioLines,
  Home,
  SlidersHorizontal,
  Radio,
  UserRound,
  ArrowRight,
  Check,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const STORAGE_KEY = 'session.tour.v1';

export function tourNeeded() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}

export function tourDone() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {}
}

export default function Onboarding({
  open,
  signedIn,
  onGo,
  onFinish,
}: {
  open: boolean;
  signedIn: boolean;
  onGo: (view: string) => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: AudioLines,
      art: 'a1',
      title: 'SESSION is where music gets made together.',
      body: 'One place for artists, producers, engineers, and videographers to meet, make, and get paid. Thirty seconds and you’ll know your way around.',
      cta: null as string | null,
    },
    {
      icon: Home,
      art: 'a2',
      title: 'Start with the feed.',
      body: 'Hear what’s moving — from people you follow and the whole community. Every play counts, trending rises worldwide, and live rooms hum at the top.',
      cta: null,
    },
    {
      icon: SlidersHorizontal,
      art: 'a3',
      title: 'Make it — right in your browser.',
      body: 'A real studio: drums, piano roll, mixer, automation, recording. Space plays. R records. Undo fixes anything.',
      cta: 'Studio',
    },
    {
      icon: Radio,
      art: 'a4',
      title: 'Go live with your circle.',
      body: 'Rooms put you face-to-face with up to four people — video, voice, and the music you’re working on, together.',
      cta: 'Studio rooms',
    },
    {
      icon: UserRound,
      art: 'a5',
      title: signedIn ? 'Make it yours.' : 'Join SESSION.',
      body: signedIn
        ? 'Set your role, add a photo, list paid services — beats, features, mixes, videos — and connect payouts to get paid by card.'
        : 'Sign in to claim your handle, build a profile, list paid services, and start making things with people worldwide.',
      cta: 'My profile',
    },
  ];
  const current = steps[step],
    last = step === steps.length - 1;
  function finish(target?: string) {
    tourDone();
    onFinish();
    if (target) onGo(target);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) finish();
      }}
    >
      <DialogContent className="form-dialog onboarding">
        <div className={'onboarding-art ' + current.art} aria-hidden="true">
          <current.icon size={40} />
          <span className="onboarding-ring" />
          <span className="onboarding-ring slow" />
        </div>
        <DialogTitle>{current.title}</DialogTitle>
        <DialogDescription>{current.body}</DialogDescription>
        <div
          className="onboarding-dots"
          aria-label={`Step ${step + 1} of ${steps.length}`}
        >
          {steps.map((_, i) => (
            <span
              key={i}
              className={i === step ? 'on' : i < step ? 'done' : ''}
            />
          ))}
        </div>
        <div className="onboarding-actions">
          <button className="button secondary" onClick={() => finish()}>
            Skip
          </button>
          {last ? (
            <button
              className="button primary"
              onClick={() => finish(current.cta || undefined)}
            >
              <Check size={16} />
              {signedIn ? 'Set up my profile' : 'Join SESSION'}
            </button>
          ) : current.cta ? (
            <button
              className="button primary"
              onClick={() => finish(current.cta || undefined)}
            >
              Take me there <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="button primary"
              onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
            >
              Next <ArrowRight size={16} />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
