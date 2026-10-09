  // Cached full-file → player Range. The page stores a complete viewed GET;
// the service worker only answers Range from that 200.
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
        if (status === 200) {
          const parsed = parseContentRange(rangeHeader);
          const whole = !rangeHeader
            || (parsed
              && parsed.start === 0
              && parsed.total > 0
              && parsed.endInclusive + 1 === parsed.total
              && chunk.byteLength === parsed.total);
          if (!whole) return null;
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

  function parseRequestRange(header, total) {
    const m = String(header || '').match(/^bytes=(\d*)-(\d*)$/i);
    if (!m || !Number.isFinite(total) || total < 1) return null;
    const suffix = m[1] === '' && m[2] !== '';
    let start;
    let end;
    if (suffix) {
      start = Math.max(0, total - Number(m[2]));
      end = total - 1;
    } else {
      start = m[1] === '' ? 0 : Number(m[1]);
      end = m[2] === '' ? total - 1 : Number(m[2]);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total) return null;
    end = Math.min(end, total - 1);
    if (end < start) return null;
    return { start, end };
  }

  /** Full cached 200 → player Range. bytes=0- stays 200 (what B2 sends). */
  function playerRangeReply(buf, rangeHeader, mime, origin) {
    const total = buf && buf.byteLength ? buf.byteLength : 0;
    const type = mime && String(mime).startsWith('video/')
      ? String(mime).split(';')[0].trim()
      : (/\.webm$/i.test(String(mime || '')) ? 'video/webm' : 'video/mp4');
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': origin || '*',
    };
    if (total < 1) {
      return { status: 200, headers: { ...headers, 'Content-Length': '0' }, body: buf || new Uint8Array(0) };
    }
    const parsed = parseRequestRange(rangeHeader, total);
    if (!parsed || (parsed.start === 0 && parsed.end === total - 1)) {
      return { status: 200, headers: { ...headers, 'Content-Length': String(total) }, body: buf };
    }
    const body = buf.slice(parsed.start, parsed.end + 1);
    return {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(body.byteLength),
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${total}`,
      },
      body,
    };
  }

  return {
    MAX_VIDEO_ASM,
    MIN_VIDEO_BYTES,
    parseContentRange,
    mergeByteRange,
    rangesCoverTotal,
    createAssembler,
    parseRequestRange,
    playerRangeReply,
  };
});
