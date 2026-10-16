const browserFetch = globalThis.fetch.bind(globalThis);

export default browserFetch;
export const fetch = browserFetch;
