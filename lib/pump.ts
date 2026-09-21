// Position follows the project clock, including seeks and loop restarts.
export function pumpAt(position: number, bpm: number, amount: number) {
  const beat = 60 / bpm,
    attack = Math.min(0.005, beat / 10);
  const phase = ((position % beat) + beat) % beat;
  return phase < attack
    ? 1 - (amount * phase) / attack
    : 1 - amount + (amount * (phase - attack)) / (beat - attack);
}
export function schedulePump(
  param: AudioParam,
  at: number,
  first: number,
  last: number,
  bpm: number,
  amount: number,
) {
  param.setValueAtTime(pumpAt(first, bpm, amount), at);
  const beat = 60 / bpm,
    attack = Math.min(0.005, beat / 10);
  for (let index = Math.floor(first / beat); index * beat < last; index++) {
    for (const position of [index * beat, index * beat + attack])
      if (position > first && position < last)
        param.linearRampToValueAtTime(
          pumpAt(position, bpm, amount),
          at + position - first,
        );
  }
  param.linearRampToValueAtTime(pumpAt(last, bpm, amount), at + last - first);
}
