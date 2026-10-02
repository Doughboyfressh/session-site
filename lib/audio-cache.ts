export class AudioCache<
  T extends { length: number; numberOfChannels: number },
> {
  private entries = new Map<string, T>();
  private bytes = 0;
  constructor(readonly limit = 64 * 1024 * 1024) {}
  get(key: string) {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }
  set(key: string, value: T) {
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.length * previous.numberOfChannels * 4;
      this.entries.delete(key);
    }
    const size = value.length * value.numberOfChannels * 4;
    if (size > this.limit) return;
    while (this.bytes + size > this.limit) {
      const oldest = this.entries.keys().next().value!;
      const removed = this.entries.get(oldest)!;
      this.bytes -= removed.length * removed.numberOfChannels * 4;
      this.entries.delete(oldest);
    }
    this.entries.set(key, value);
    this.bytes += size;
  }
  stats() {
    return { bytes: this.bytes, entries: this.entries.size, limit: this.limit };
  }
}
