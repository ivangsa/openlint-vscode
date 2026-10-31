import type { ExtensionConfig } from './config';
import type { Logger } from './logger';

export type TimingStage = 'ruleset' | 'engine' | 'parse' | 'execution' | 'git' | 'attribution';

export interface LintQueueInfo {
  readonly debounceMs: number;
  readonly waitedMs: number;
}

export class LintTimings {
  cache?: 'hit' | 'miss';
  diagnostics?: number;

  private readonly enabled: boolean;
  private readonly started: number;
  private readonly stages = new Map<TimingStage, number>();
  private readonly chars: number;
  private readonly lines: number;

  constructor(
    private readonly logger: Pick<Logger, 'debug'>,
    private readonly verbosity: ExtensionConfig['outputVerbosity'],
    private readonly source: string,
    text: string,
    private readonly diffFilter: ExtensionConfig['diffFilter'],
    private readonly queue?: LintQueueInfo
  ) {
    this.enabled = verbosity === 'debug';
    this.started = this.enabled ? performance.now() : 0;
    this.chars = this.enabled ? text.length : 0;
    this.lines = this.enabled ? countLines(text) : 0;
  }

  async measure<T>(stage: TimingStage, operation: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return operation();
    }

    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.stages.set(stage, performance.now() - started);
    }
  }

  measureSync<T>(stage: TimingStage, operation: () => T): T {
    if (!this.enabled) {
      return operation();
    }

    const started = performance.now();
    try {
      return operation();
    } finally {
      this.stages.set(stage, performance.now() - started);
    }
  }

  log(): void {
    if (!this.enabled) {
      return;
    }

    const parts = [
      `${this.lines.toLocaleString('en-US')} lines / ${this.chars.toLocaleString('en-US')} chars`,
      `ruleset cache=${this.cache ?? 'n/a'}`,
      `diff=${this.diffFilter}`
    ];
    if (this.queue) {
      const lag = Math.max(0, this.queue.waitedMs - this.queue.debounceMs);
      parts.push(`queue=${formatMilliseconds(this.queue.waitedMs)} (lag ${formatMilliseconds(lag)})`);
    }
    for (const [name, elapsed] of this.stages) {
      parts.push(`${name}=${formatMilliseconds(elapsed)}`);
    }
    parts.push(
      `diagnostics=${this.diagnostics ?? 'n/a'}`,
      `total=${formatMilliseconds(performance.now() - this.started)}`
    );
    this.logger.debug(this.verbosity, `Lint profile for ${this.source}: ${parts.join(', ')}.`);
  }
}

function countLines(text: string): number {
  let lines = 1;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lines += 1;
  }

  return lines;
}

function formatMilliseconds(value: number): string {
  return `${value.toFixed(1)} ms`;
}
