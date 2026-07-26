export const constants = {
  Z_BEST_COMPRESSION: 9,
  Z_BEST_SPEED: 1,
  Z_DEFAULT_COMPRESSION: -1,
};

// ponytail: just-bash documents gzip as unavailable in browsers; use a web
// compression implementation if archive commands become necessary.
const unsupported = (): never => {
  throw new Error("gzip is unavailable in the browser shell");
};

export const gunzipSync = unsupported;
export const gzipSync = unsupported;
