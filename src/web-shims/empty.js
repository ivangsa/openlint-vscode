export default {};
export const promises = {};
export const constants = {};
export function readFile(_path, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const error = new Error('Node fs is not available in the web extension host.');
  if (typeof done === 'function') {
    done(error);
    return;
  }

  throw error;
}
export function readFileSync() {
  throw new Error('Node fs is not available in the web extension host.');
}
export function existsSync() {
  return false;
}
export function createReadStream() {
  throw new Error('Node fs is not available in the web extension host.');
}
