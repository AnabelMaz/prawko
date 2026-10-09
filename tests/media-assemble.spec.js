const { test, expect } = require('@playwright/test');
const {
  parseContentRange,
  mergeByteRange,
  rangesCoverTotal,
  createAssembler,
  MIN_VIDEO_BYTES,
  parseRequestRange,
  playerRangeReply,
} = require('../src/js/media-assemble.js');

test.describe('CDN video range assembly', () => {
  test('parses Content-Range and merges holes until 0..total', () => {
    expect(parseContentRange('bytes 0-3/8')).toEqual({ start: 0, endInclusive: 3, total: 8 });
    expect(mergeByteRange([], 0, 4)).toEqual([[0, 4]]);
    expect(mergeByteRange([[0, 4]], 4, 8)).toEqual([[0, 8]]);
    expect(rangesCoverTotal([[0, 4]], 8)).toBe(false);
    expect(rangesCoverTotal([[0, 8]], 8)).toBe(true);
  });

  test('stores only after every byte of the file has arrived', () => {
    const a = createAssembler();
    const key = 'https://f003.backblazeb2.com/file/prawko-maz/vid/clip.mp4';
    const first = a.pushChunk(key, 206, 'bytes 0-3/8', new Uint8Array([1, 2, 3, 4]), 'video/mp4');
    expect(first).toBeNull();
    const second = a.pushChunk(key, 206, 'bytes 4-7/8', new Uint8Array([5, 6, 7, 8]), 'video/mp4');
    expect(Array.from(second.buf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(second.key).toBe(key);
  });

  test('does not store a partial file after switching to another video', () => {
    const a = createAssembler();
    const aUrl = 'https://f003.backblazeb2.com/file/prawko-maz/vid/a.mp4';
    const bUrl = 'https://f003.backblazeb2.com/file/prawko-maz/vid/b.mp4';
    expect(a.pushChunk(aUrl, 206, 'bytes 0-3/8', new Uint8Array([1, 2, 3, 4]), 'video/mp4')).toBeNull();
    expect(a.pushChunk(bUrl, 206, 'bytes 0-3/8', new Uint8Array([9, 9, 9, 9]), 'video/mp4')).toBeNull();
    expect(a.pushChunk(aUrl, 206, 'bytes 4-7/8', new Uint8Array([5, 6, 7, 8]), 'video/mp4')).toBeNull();
  });

  test('a complete 200 body is stored; a tiny one is not', () => {
    const a = createAssembler();
    const key = 'https://f003.backblazeb2.com/file/prawko-maz/vid/full.mp4';
    const small = a.pushChunk(key, 200, '', new Uint8Array(64).fill(1), 'video/mp4');
    expect(small).toBeNull();
    const full = new Uint8Array(MIN_VIDEO_BYTES).fill(7);
    const done = a.pushChunk(key, 200, '', full, 'video/mp4');
    expect(done.buf.byteLength).toBe(MIN_VIDEO_BYTES);
    expect(done.buf[0]).toBe(7);
  });

  test('a 200 with Content-Range for the whole file is stored', () => {
    const a = createAssembler();
    const key = 'https://f003.backblazeb2.com/file/prawko-maz/vid/ranged-200.mp4';
    const full = new Uint8Array(MIN_VIDEO_BYTES).fill(3);
    const done = a.pushChunk(
      key,
      200,
      `bytes 0-${MIN_VIDEO_BYTES - 1}/${MIN_VIDEO_BYTES}`,
      full,
      'video/mp4',
    );
    expect(done.buf.byteLength).toBe(MIN_VIDEO_BYTES);
    expect(done.buf[0]).toBe(3);
  });

  test('player Range bytes=0- on a cached file stays a full 200', () => {
    const buf = new Uint8Array(8).fill(9);
    const whole = playerRangeReply(buf, 'bytes=0-', 'video/mp4', 'https://anabelmaz.github.io');
    expect(whole.status).toBe(200);
    expect(whole.headers['Accept-Ranges']).toBe('bytes');
    expect(whole.headers['Content-Length']).toBe('8');
    expect(whole.body.byteLength).toBe(8);
    expect(parseRequestRange('bytes=0-', 8)).toEqual({ start: 0, end: 7 });
    const part = playerRangeReply(buf, 'bytes=2-5', 'video/mp4', 'https://anabelmaz.github.io');
    expect(part.status).toBe(206);
    expect(part.headers['Content-Range']).toBe('bytes 2-5/8');
    expect(Array.from(part.body)).toEqual([9, 9, 9, 9]);
  });

});
