export const process = {
  env: { NODE_ENV: 'production' },
  platform: 'browser',
  browser: true,
  versions: { node: '' },
  cwd() {
    return '/';
  },
  nextTick(callback, ...args) {
    queueMicrotask(() => callback(...args));
  }
};
