/** Retains the last `maxBytes` of appended UTF-8 output. */
export class RawRingBuffer {
  private chunks: Uint8Array[] = [];
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  appendText(s: string): void {
    const enc = new TextEncoder();
    this.appendU8(enc.encode(s));
  }

  appendU8(u8: Uint8Array): void {
    this.chunks.push(u8);
    this.total += u8.length;
    while (this.total > this.maxBytes && this.chunks.length > 0) {
      const first = this.chunks.shift();
      if (first) this.total -= first.length;
    }
  }

  /** Concatenated bytes currently retained (oldest to newest). */
  snapshotBytes(): Uint8Array {
    const out = new Uint8Array(this.total);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}
