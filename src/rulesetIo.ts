export interface RulesetIo {
  fetch: typeof fetch;
  fs: {
    promises: {
      readFile: (
        path: string | URL,
        options?: { encoding?: BufferEncoding | null } | BufferEncoding | null
      ) => Promise<string | Uint8Array>;
    };
  };
}
