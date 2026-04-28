const MAX = 500;

export class CommentaryCache {
  private cache = new Map<string, string>();

  key(persona: string, eventType: string, batsman: string, bowler: string): string {
    return `${persona}:${eventType}:${batsman.toLowerCase()}:${bowler.toLowerCase()}`;
  }

  get(k: string): string | undefined {
    return this.cache.get(k);
  }

  set(k: string, value: string): void {
    if (this.cache.size >= MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(k, value);
  }

  get size(): number { return this.cache.size; }
}
