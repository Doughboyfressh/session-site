type MediaKind = 'audio' | 'video';

type Replacement = {
  isCurrent: () => boolean;
  local: () => MediaStream | null;
  senders: () => RTCRtpSender[];
  publish: (stream: MediaStream) => void;
};

/** Call controls also cover tracks waiting for an asynchronous device switch. */
export class RoomMediaControls {
  private enabled = { audio: true, video: true };
  private requests = { audio: 0, video: 0 };
  private pending = new Set<MediaStreamTrack>();
  private queues = { audio: Promise.resolve(), video: Promise.resolve() };

  isEnabled(kind: MediaKind) {
    return this.enabled[kind];
  }

  setEnabled(kind: MediaKind, enabled: boolean, stream: MediaStream | null) {
    this.enabled[kind] = enabled;
    for (const track of [...(stream?.getTracks() || []), ...this.pending])
      if (track.kind === kind) track.enabled = enabled;
  }

  cancelPending() {
    this.requests.audio++;
    this.requests.video++;
    for (const track of this.pending) track.stop();
    this.pending.clear();
  }

  async switchTrack(
    kind: MediaKind,
    acquire: () => Promise<MediaStream>,
    replacement: Replacement,
  ): Promise<boolean> {
    const request = ++this.requests[kind];
    const current = () =>
      request === this.requests[kind] && replacement.isCurrent();
    let acquired: MediaStream | null = null;
    let track: MediaStreamTrack | undefined;
    let published = false;
    try {
      if (!current() || !replacement.local()) return false;
      acquired = await acquire();
      if (!current() || !replacement.local()) return false;
      track = acquired.getTracks().find((t) => t.kind === kind);
      if (!track || track.readyState !== 'live')
        throw new Error(
          kind === 'audio'
            ? 'That microphone returned no live audio.'
            : 'That camera returned no live video.',
        );
      // Set privacy intent before handing the track to any sender or preview.
      track.enabled = this.enabled[kind];
      this.pending.add(track);
      for (const extra of acquired.getTracks())
        if (extra !== track) extra.stop();
      const nextTrack = track;
      const operation = this.queues[kind].then(async () => {
        if (!current() || !replacement.local()) return false;
        const old = replacement
          .local()!
          .getTracks()
          .find((t) => t.kind === kind);
        const replaced: RTCRtpSender[] = [];
        const restore = async () => {
          for (const sender of replaced)
            if (sender.track === nextTrack)
              try {
                await sender.replaceTrack(old || null);
              } catch {
                // A closed/disconnected sender cannot keep capturing this track.
                nextTrack.stop();
              }
        };
        try {
          for (const sender of replacement.senders()) {
            if (!old || sender.track !== old) continue;
            if (!current()) {
              await restore();
              return false;
            }
            await sender.replaceTrack(nextTrack);
            replaced.push(sender);
          }
          if (!current() || !replacement.local()) {
            await restore();
            return false;
          }
          if (nextTrack.readyState !== 'live')
            throw new Error(
              kind === 'audio'
                ? 'That microphone stopped before it could be switched.'
                : 'That camera stopped before it could be switched.',
            );
          const carried = replacement
            .local()!
            .getTracks()
            .filter((t) => t.kind !== kind);
          // Controls may have changed while replaceTrack was pending.
          nextTrack.enabled = this.enabled[kind];
          replacement.publish(new MediaStream([...carried, nextTrack]));
          published = true;
          old?.stop();
          return true;
        } catch (error) {
          await restore();
          throw error;
        }
      });
      // Serialize adoption of the same kind so stale rollback cannot undo a
      // newer device switch. Microphone and camera acquisition stay independent.
      this.queues[kind] = operation.then(
        () => {},
        () => {},
      );
      return await operation;
    } catch (error) {
      if (current()) throw error;
      return false;
    } finally {
      if (track) this.pending.delete(track);
      if (!published) acquired?.getTracks().forEach((t) => t.stop());
    }
  }
}
