export type PeerCallbacks = {
  send: (body: any) => Promise<void>;
  stream: (stream: MediaStream, remove: boolean) => void;
  state: (state: string) => void;
};
export class PeerLink {
  pc: RTCPeerConnection;
  closed = false;
  makingOffer = false;
  settingAnswer = false;
  ignoreOffer = false;
  polite: boolean;
  pending: RTCIceCandidateInit[] = [];
  queue: Promise<void> = Promise.resolve();
  outgoing: Promise<void> = Promise.resolve();
  streams = new Map<string, MediaStream>();
  restarts = 0;
  recovery: ReturnType<typeof setTimeout> | null = null;
  constructor(
    public localId: string,
    public remoteId: string,
    config: RTCConfiguration,
    public callbacks: PeerCallbacks,
  ) {
    this.polite = localId > remoteId;
    this.pc = new RTCPeerConnection(config);
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ candidate: e.candidate.toJSON() });
    };
    this.pc.onnegotiationneeded = async () => {
      if (this.closed) return;
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (!this.closed)
          this.send({ description: this.pc.localDescription?.toJSON() });
      } catch (e: any) {
        if (!this.closed)
          this.callbacks.state(
            'Negotiation failed (' + e.name + ') — reconnect',
          );
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream || this.closed) return;
      this.streams.set(stream.id, stream);
      const show = () => {
        if (!this.closed && this.streams.get(stream.id) === stream)
          this.callbacks.stream(stream, false);
      };
      e.track.onunmute = show;
      show();
      stream.onremovetrack = () => {
        if (this.streams.get(stream.id) !== stream) return;
        if (!stream.getTracks().some((t) => t.readyState === 'live')) {
          this.callbacks.stream(stream, true);
          this.streams.delete(stream.id);
        }
      };
    };
    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      this.callbacks.state(this.pc.connectionState);
      if (this.pc.connectionState === 'connected') {
        this.restarts = 0;
        if (this.recovery) clearTimeout(this.recovery);
      } else if (['failed', 'disconnected'].includes(this.pc.connectionState)) {
        if (this.recovery) clearTimeout(this.recovery);
        this.recovery = setTimeout(
          () => {
            if (!this.closed && this.restarts < 3) {
              this.restarts++;
              this.callbacks.state('recovering');
              this.requestRestart();
            } else if (!this.closed)
              this.callbacks.state('Connection failed — reconnect');
          },
          this.pc.connectionState === 'failed' ? 600 : 4000,
        );
      }
    };
  }
  send(body: any) {
    this.outgoing = this.outgoing.then(async () => {
      for (let attempt = 0; attempt < 3 && !this.closed; attempt++) {
        try {
          await this.callbacks.send(body);
          return;
        } catch {
          if (attempt === 2) {
            this.callbacks.state('Signaling interrupted');
            return;
          }
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        }
      }
    });
  }
  receive(body: any) {
    this.queue = this.queue
      .then(async () => {
        if (this.closed) return;
        if (body.restart === true) {
          if (!this.polite) this.requestRestart();
          return;
        }
        if (body.description) {
          const d = body.description;
          const ready =
            !this.makingOffer &&
            (this.pc.signalingState === 'stable' || this.settingAnswer);
          this.ignoreOffer = !this.polite && d.type === 'offer' && !ready;
          if (this.ignoreOffer) {
            this.pending = [];
            return;
          }
          this.settingAnswer = d.type === 'answer';
          try {
            await this.pc.setRemoteDescription(d);
          } finally {
            this.settingAnswer = false;
          }
          const ufrag = this.pc.remoteDescription?.sdp.match(
            /a=ice-ufrag:([^\r\n]+)/,
          )?.[1];
          for (const candidate of this.pending) {
            if (
              !candidate.usernameFragment ||
              !ufrag ||
              candidate.usernameFragment === ufrag
            )
              await this.pc.addIceCandidate(candidate);
          }
          this.pending = [];
          if (d.type === 'offer') {
            await this.pc.setLocalDescription();
            if (!this.closed)
              this.send({ description: this.pc.localDescription?.toJSON() });
          }
        } else if (body.candidate && !this.ignoreOffer) {
          if (!this.pc.remoteDescription) this.pending.push(body.candidate);
          else {
            const ufrag = this.pc.remoteDescription.sdp.match(
              /a=ice-ufrag:([^\r\n]+)/,
            )?.[1];
            if (
              !body.candidate.usernameFragment ||
              !ufrag ||
              body.candidate.usernameFragment === ufrag
            )
              await this.pc.addIceCandidate(body.candidate);
          }
        }
      })
      .catch((e: any) => {
        if (!this.closed)
          this.callbacks.state(
            'Media negotiation interrupted (' + e.name + ')',
          );
      });
    return this.queue;
  }
  setStreams(streams: MediaStream[]) {
    if (this.closed) return;
    const wanted = streams.flatMap((s) => s.getTracks());
    for (const sender of this.pc.getSenders())
      if (sender.track && !wanted.includes(sender.track))
        this.pc.removeTrack(sender);
    for (const stream of streams)
      for (const track of stream.getTracks())
        if (!this.pc.getSenders().some((s) => s.track === track))
          this.pc.addTrack(track, stream);
  }
  restart() {
    if (this.closed) return;
    this.restarts = 0;
    this.requestRestart();
    this.callbacks.state('recovering');
  }
  requestRestart() {
    if (this.closed) return;
    // One elected peer drives ICE restarts so two users reconnecting together
    // cannot roll back each other's active media transports.
    if (this.polite) this.send({ restart: true });
    else if (this.pc.signalingState === 'stable' && !this.makingOffer)
      this.pc.restartIce();
  }
  async stats() {
    const stats = await this.pc.getStats();
    let transport: any;
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) transport = s;
    });
    const pair = transport
        ? stats.get(transport.selectedCandidatePairId)
        : undefined,
      local = pair ? stats.get(pair.localCandidateId) : undefined;
    let bytes = 0,
      packets = 0,
      lost = 0,
      jitter = 0,
      frames = 0,
      energy = 0,
      samples = 0;
    stats.forEach((s) => {
      if (s.type === 'inbound-rtp') {
        bytes += s.bytesReceived || 0;
        packets += s.packetsReceived || 0;
        lost += Math.max(0, s.packetsLost || 0);
        jitter = Math.max(jitter, s.jitter || 0);
        frames += s.framesDecoded || 0;
        energy += s.totalAudioEnergy || 0;
        samples += s.totalSamplesDuration || 0;
      }
    });
    return {
      state: this.pc.connectionState,
      route: local?.candidateType || 'connecting',
      rtt: Math.round((pair?.currentRoundTripTime || 0) * 1000),
      jitter: Math.round(jitter * 1000),
      loss: packets ? Math.round((lost / (packets + lost)) * 1000) / 10 : 0,
      bytes,
      packets,
      frames,
      energy,
      samples,
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.recovery) clearTimeout(this.recovery);
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.close();
    this.streams.forEach((s) => this.callbacks.stream(s, true));
    this.streams.clear();
    this.pending = [];
  }
}
