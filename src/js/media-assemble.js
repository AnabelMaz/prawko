  // Byte-range assembly for CDN and LAN videos. Used by the service worker so a complete
// file can go into the offline cache without touching question rendering.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PrawkoVideoAssemble = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const MAX_VIDEO_ASM = 80 * 1024 * 1024;
  const MIN_VIDEO_BYTES = 256;

  function parseContentRange(header) {
    const m = String(header || '').match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    if (!m) return null;
    const start = Number(m[1]);
    const endInclusive = Number(m[2]);
    const total = m[3] === '*' ? 0 : Number(m[3]);
    if (!Number.isFinite(start) || !Number.isFinite(endInclusive) || endInclusive < start) return null;
    if (m[3] !== '*' && !Number.isFinite(total)) return null;
    return { start, endInclusive, total };
  }

  function mergeByteRange(ranges, start, endExclusive) {
    const next = (ranges || []).concat([[start, endExclusive]]);
    next.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const r of next) {
      const last = merged[merged.length - 1];
      if (!last || last[1] < r[0]) merged.push([r[0], r[1]]);
      else last[1] = Math.max(last[1], r[1]);
    }
    return merged;
  }

  function rangesCoverTotal(ranges, total) {
    return total > 0
      && Array.isArray(ranges)
      && ranges.length === 1
      && ranges[0][0] === 0
      && ranges[0][1] === total;
  }

  function createAssembler() {
    let cur = null;
    return {
      drop() {
        cur = null;
      },
      pushChunk(key, status, contentRangeHeader, chunk, mime) {
        if (!key || !chunk || !chunk.byteLength) return null;
        const rangeHeader = contentRangeHeader || '';
        if (status === 200 && !rangeHeader) {
          cur = null;
          if (chunk.byteLength < MIN_VIDEO_BYTES || chunk.byteLength > MAX_VIDEO_ASM) return null;
          return { key, buf: chunk, mime };
        }
        if (status !== 206) return null;
        const parsed = parseContentRange(rangeHeader);
        if (!parsed || !parsed.total || parsed.total > MAX_VIDEO_ASM) {
          cur = null;
          return null;
        }
        if (!cur || cur.key !== key || cur.total !== parsed.total) {
          cur = {
            key,
            total: parsed.total,
            buf: new Uint8Array(parsed.total),
            ranges: [],
            mime,
          };
        }
        const endExclusive = parsed.start + chunk.byteLength;
        if (parsed.start < 0 || endExclusive > cur.total) {
          cur = null;
          return null;
        }
        cur.buf.set(chunk, parsed.start);
        cur.ranges = mergeByteRange(cur.ranges, parsed.start, endExclusive);
        if (mime) cur.mime = mime;
        if (!rangesCoverTotal(cur.ranges, cur.total)) return null;
        const done = { key: cur.key, buf: cur.buf, mime: cur.mime };
        cur = null;
        return done;
      },
    };
  }

  function shouldAssembleVideo(pageOrigin, hostname, requestUrl) {
    let url;
    try {
      url = new URL(requestUrl, pageOrigin);
    } catch {
      return false;
    }
    if (!/\/vid\/[^/]+\.(mp4|webm)(\?|$)/i.test(url.pathname)) return false;
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    let origin = pageOrigin;
    try {
      origin = new URL(pageOrigin).origin;
    } catch { /* keep pageOrigin */ }
    if (url.origin !== origin) return true;
    if (loopback) return false;
    return /\/media\/vid\//i.test(url.pathname);
  }

  return {
    MAX_VIDEO_ASM,
    MIN_VIDEO_BYTES,
    parseContentRange,
    mergeByteRange,
    rangesCoverTotal,
    createAssembler,
    shouldAssembleVideo,
  };
});
