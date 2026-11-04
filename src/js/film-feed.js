// One download feeds the player. Play and pause do not start another request.
// The bytes are stored only after the response body has arrived in full.
// A faststart H.264 file (moov first, no audio) is turned into fragments so
// the picture can start before the last byte. While bytes are still arriving,
// each chunk re-checks whether leftover download time (at the measured rate)
// fits in 75% of the film length (25% headroom). Once play starts, that
// decision stands — no mid-play pause from the pace check. Anything else
// waits for the whole body and then plays that blob. Leaving early aborts.

/** Leftover download must fit in this fraction of the film length to start. */
export const FILM_PACE_FRACTION = 0.75;

/** True when leftover download time fits in durationSec with 25% headroom.
 *  Needs 2% of the file first so the rate is a real sample — no fixed delay. */
export function filmPaceOk(received, total, elapsedSec, durationSec) {
  if (total > 0 && received >= total) return true;
  if (!(total > 0) || !(durationSec > 0) || !(received > 0) || !(elapsedSec > 0)) {
    return false;
  }
  if (received / total < 0.02) return false;
  const remainSec = ((total - received) * elapsedSec) / received;
  return remainSec <= durationSec * FILM_PACE_FRACTION;
}

export function filmReadyToStart(received, total, elapsedSec, durationSec) {
  return filmPaceOk(received, total, elapsedSec, durationSec);
}

let owned = null;

export function abortOwnedMedia() {
  if (!owned) return;
  const current = owned;
  owned = null;
  current.abort();
}

export function startOwnedMedia(el, url, store) {
  abortOwnedMedia();
  const ctrl = new AbortController();
  let revoked = '';
  const generation = {};
  owned = {
    generation,
    abort() {
      ctrl.abort();
      if (revoked) {
        URL.revokeObjectURL(revoked);
        revoked = '';
      }
    },
  };
  el.dataset.byteSource = 'live';
  const rememberUrl = (objectUrl) => {
    const previous = revoked;
    revoked = objectUrl;
    return previous;
  };
  const still = () => owned && owned.generation === generation;
  const task = el.tagName === 'IMG'
    ? loadImage(el, url, ctrl.signal, store, still, rememberUrl)
    : loadFilm(el, url, ctrl.signal, store, still, rememberUrl);
  task.catch(() => {
    if (!still() || ctrl.signal.aborted) return;
    el.dispatchEvent(new Event('error'));
  });
}

async function loadImage(el, url, signal, store, still, rememberUrl) {
  const res = await fetch(url, { credentials: 'omit', signal });
  if (!res.ok || res.status !== 200) throw new Error('image');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = imageType(url, res.headers.get('Content-Type'));
  const blob = new Blob([bytes], { type });
  await store(url, blob);
  if (!still()) return;
  const objectUrl = URL.createObjectURL(blob);
  rememberUrl(objectUrl);
  el.dataset.byteSource = 'stored';
  el.src = objectUrl;
}

async function loadFilm(video, url, signal, store, still, rememberUrl) {
  const res = await fetch(url, { credentials: 'omit', signal });
  if (!res.ok || res.status !== 200 || !res.body) throw new Error('film');
  const total = Number(res.headers.get('Content-Length')) || 0;
  const startedAt = performance.now();
  // Keep the caller's intent, but clear the attribute so the browser does not
  // start as soon as the first MSE fragment lands — only our pace check may.
  const wantPlay = video.autoplay === true;
  video.autoplay = false;
  const chunks = [];
  let received = 0;
  const reader = res.body.getReader();
  let index = null;
  let session = null;
  const pace = {
    done: false,
    mayStart() {
      if (pace.done) return true;
      const durationSec = index && index.duration > 0 ? index.duration : 0;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      return filmReadyToStart(received, total, elapsedSec, durationSec);
    },
  };
  const pump = () => {
    if (!index) {
      index = indexFaststart(mergedPrefix(chunks, received));
    }
    if (!index || !session) return;
    session.push(chunks, received, index);
  };
  const open = openFilmPlayer(video, rememberUrl, () => pace.mayStart(), wantPlay);
  session = open.session;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      if (!still() || signal.aborted) {
        reader.cancel().catch(() => {});
        return;
      }
      chunks.push(step.value);
      received += step.value.byteLength;
      if (!session) continue;
      pump();
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    throw err;
  }
  pace.done = true;
  const bytes = concatChunks(chunks, received);
  const blob = new Blob([bytes], { type: 'video/mp4' });
  await store(url, blob);
  if (!still()) return;
  video.dataset.byteSource = 'stored';
  if (!index) index = indexFaststart(bytes);
  if (session && index && !session.failed()) {
    session.finish(chunks, received, index);
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  video.src = objectUrl;
  const previous = rememberUrl(objectUrl);
  if (previous && previous !== objectUrl) URL.revokeObjectURL(previous);
  if (wantPlay) {
    const pending = video.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }
}

function imageType(url, header) {
  const raw = String(header || '').split(';')[0].trim();
  if (raw.startsWith('image/')) return raw;
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.jpe?g(\?|$)/i.test(url)) return 'image/jpeg';
  if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
  return 'image/webp';
}

function mergedPrefix(chunks, received) {
  const take = Math.min(received, 512 * 1024);
  return sliceChunks(chunks, 0, take);
}

function concatChunks(chunks, received) {
  return sliceChunks(chunks, 0, received);
}

function sliceChunks(chunks, start, end) {
  const out = new Uint8Array(Math.max(0, end - start));
  let pos = 0;
  let filled = 0;
  for (const chunk of chunks) {
    const next = pos + chunk.length;
    if (next > start && pos < end) {
      const from = Math.max(0, start - pos);
      const to = Math.min(chunk.length, end - pos);
      out.set(chunk.subarray(from, to), filled);
      filled += to - from;
    }
    pos = next;
    if (pos >= end) break;
  }
  return out;
}

function openFilmPlayer(video, rememberUrl, mayStart, wantPlay) {
  if (typeof MediaSource === 'undefined') return { session: null };
  const media = new MediaSource();
  const objectUrl = URL.createObjectURL(media);
  rememberUrl(objectUrl);
  let sourceBuffer = null;
  let index = null;
  let emitted = 0;
  const queue = [];
  let done = false;
  let failed = false;
  let kicked = false;
  let durationSet = false;
  let lastChunks = [];
  let lastReceived = 0;
  // Only the start gate. After play begins we do not pause for pace again.
  const kick = () => {
    if (kicked || !wantPlay || failed || emitted < 1) return;
    if (typeof mayStart === 'function' && !mayStart()) return;
    kicked = true;
    const pending = video.play();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  };
  const drain = () => {
    if (!sourceBuffer || sourceBuffer.updating || !queue.length || failed) return;
    const next = queue.shift();
    try { sourceBuffer.appendBuffer(next); }
    catch { failed = true; }
  };
  let initQueued = false;
  const enqueueReady = (chunks, received) => {
    lastChunks = chunks;
    lastReceived = received;
    if (!index || failed || !sourceBuffer) return;
    if (!initQueued) {
      initQueued = true;
      queue.push(index.init);
    }
    const batch = nextSamples(index, emitted, chunks, received);
    if (batch) {
      emitted += batch.samples.length;
      queue.push(mediaSegment(batch));
    }
    drain();
    kick();
  };
  const finishStream = () => {
    if (failed || !sourceBuffer || sourceBuffer.updating || queue.length) return;
    if (!done || !index || emitted < index.samples.length) return;
    try { media.endOfStream(); } catch { /* already ended */ }
    kick();
  };
  const session = {
    push(chunks, received, parsed) {
      index = parsed;
      enqueueReady(chunks, received);
    },
    finish(chunks, received, parsed) {
      index = parsed;
      done = true;
      enqueueReady(chunks, received);
      finishStream();
    },
    failed() { return failed; },
  };
  video.src = objectUrl;
  media.addEventListener('sourceopen', () => {
    if (media.sourceBuffers.length || failed) return;
    const codec = (index && index.codec) || 'avc1.42E01E';
    const mime = `video/mp4; codecs="${codec}"`;
    if (!MediaSource.isTypeSupported(mime)) {
      failed = true;
      return;
    }
    try {
      sourceBuffer = media.addSourceBuffer(mime);
    } catch {
      failed = true;
      return;
    }
    sourceBuffer.mode = 'segments';
    sourceBuffer.addEventListener('error', () => { failed = true; });
    sourceBuffer.addEventListener('updateend', () => {
      if (!durationSet && index && index.duration > 0) {
        durationSet = true;
        try { media.duration = index.duration; } catch { /* a later fragment sets it */ }
      }
      kick();
      if (index) enqueueReady(lastChunks, lastReceived);
      finishStream();
    });
    if (index) enqueueReady(lastChunks, lastReceived);
  });
  return { session };
}

function nextSamples(index, emitted, chunks, received) {
  if (emitted >= index.samples.length) return null;
  const samples = [];
  let span = 0;
  while (emitted + samples.length < index.samples.length) {
    const sample = index.samples[emitted + samples.length];
    if (sample.offset + sample.size > received) break;
    samples.push(sample);
    span += sample.duration;
    if (span >= index.timescale * 0.4 && samples.length) break;
  }
  if (!samples.length) return null;
  const parts = samples.map((sample) => sliceChunks(chunks, sample.offset, sample.offset + sample.size));
  return {
    samples,
    payload: concatParts(parts),
    base: baseTime(index, emitted),
    trackId: index.trackId,
  };
}

function baseTime(index, emitted) {
  let time = 0;
  for (let i = 0; i < emitted; i++) time += index.samples[i].duration;
  return time;
}

let fragmentSeq = 1;

function mediaSegment(batch) {
  const seq = fragmentSeq++;
  return concatParts([
    moofBox(seq, batch.trackId, batch.base, batch.samples),
    mdatBox(batch.payload),
  ]);
}

export function indexFaststart(u8) {
  if (!u8 || u8.length < 16) return null;
  let moov = null;
  for (const box of listBoxes(u8, 0, u8.length)) {
    if (box.type === 'moov') moov = box;
  }
  if (!moov) return null;
  const mvhd = childBox(u8, moov, 'mvhd');
  const trak = childBox(u8, moov, 'trak');
  if (!mvhd || !trak) return null;
  const tkhd = childBox(u8, trak, 'tkhd');
  const mdia = childBox(u8, trak, 'mdia');
  if (!tkhd || !mdia) return null;
  const mdhd = childBox(u8, mdia, 'mdhd');
  const hdlr = childBox(u8, mdia, 'hdlr');
  const minf = childBox(u8, mdia, 'minf');
  if (!mdhd || !hdlr || !minf) return null;
  const vmhd = childBox(u8, minf, 'vmhd');
  const dinf = childBox(u8, minf, 'dinf');
  const stbl = childBox(u8, minf, 'stbl');
  if (!vmhd || !dinf || !stbl) return null;
  const stsd = childBox(u8, stbl, 'stsd');
  const stts = childBox(u8, stbl, 'stts');
  const stsc = childBox(u8, stbl, 'stsc');
  const stsz = childBox(u8, stbl, 'stsz');
  const stco = childBox(u8, stbl, 'stco') || childBox(u8, stbl, 'co64');
  if (!stsd || !stts || !stsc || !stsz || !stco) return null;
  const avc = avcInfo(u8, stsd);
  if (!avc) return null;
  const clock = mdhdClock(u8, mdhd);
  if (!clock || !clock.timescale) return null;
  const sizes = sampleSizes(u8, stsz);
  const durations = expandRuns(u8, stts, sizes.length);
  const offsets = sampleOffsets(u8, stsc, stco, sizes);
  if (!sizes.length || durations.length !== sizes.length || !offsets) return null;
  const sync = syncSet(u8, childBox(u8, stbl, 'stss'), sizes.length);
  const ctts = compositionOffsets(u8, childBox(u8, stbl, 'ctts'), sizes.length);
  const samples = sizes.map((size, i) => ({
    offset: offsets[i],
    size,
    duration: durations[i],
    cto: ctts ? ctts[i] : 0,
    sync: sync.has(i + 1),
  }));
  const trackId = trackIdOf(u8, tkhd);
  const duration = clock.duration > 0
    ? clock.duration / clock.timescale
    : samples.reduce((sum, sample) => sum + sample.duration, 0) / clock.timescale;
  const init = initSegment({
    mvhd: zeroDuration(u8, mvhd, 'mvhd'),
    tkhd: zeroDuration(u8, tkhd, 'tkhd'),
    mdhd: zeroDuration(u8, mdhd, 'mdhd'),
    hdlr: bytesOf(u8, hdlr),
    vmhd: bytesOf(u8, vmhd),
    dinf: bytesOf(u8, dinf),
    stsd: bytesOf(u8, stsd),
    trackId,
  });
  return { samples, timescale: clock.timescale, duration, trackId, codec: avc.codec, init };
}

function listBoxes(u8, start, end) {
  const out = [];
  let offset = start;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset);
    let size = size32;
    let header = 8;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    out.push({
      type: String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7]),
      start: offset,
      header,
      end: offset + size,
    });
    offset += size;
  }
  return out;
}

function childBox(u8, parent, type) {
  if (!parent) return null;
  for (const box of listBoxes(u8, parent.start + parent.header, parent.end)) {
    if (box.type === type) return box;
  }
  return null;
}

function bytesOf(u8, box) {
  return u8.slice(box.start, box.end);
}

function avcInfo(u8, stsd) {
  const entries = stsd.start + stsd.header + 8;
  for (const entry of listBoxes(u8, entries, stsd.end)) {
    if (entry.type !== 'avc1' && entry.type !== 'avc3') continue;
    const childAt = entry.start + 86;
    if (childAt >= entry.end) continue;
    for (const child of listBoxes(u8, childAt, entry.end)) {
      if (child.type !== 'avcC') continue;
      const body = child.start + child.header;
      if (body + 4 > child.end) continue;
      const hex = (n) => n.toString(16).padStart(2, '0');
      return { codec: `avc1.${hex(u8[body + 1])}${hex(u8[body + 2])}${hex(u8[body + 3])}` };
    }
  }
  return null;
}

function mdhdClock(u8, box) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = u8[box.start + box.header];
  if (version === 1) {
    const timescale = view.getUint32(box.start + box.header + 20);
    const duration = Number(view.getBigUint64(box.start + box.header + 24));
    return { timescale, duration };
  }
  return {
    timescale: view.getUint32(box.start + box.header + 12),
    duration: view.getUint32(box.start + box.header + 16),
  };
}

function trackIdOf(u8, tkhd) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = u8[tkhd.start + tkhd.header];
  const at = tkhd.start + tkhd.header + (version === 1 ? 20 : 12);
  return view.getUint32(at);
}

function sampleSizes(u8, stsz) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const fixed = view.getUint32(stsz.start + stsz.header + 4);
  const count = view.getUint32(stsz.start + stsz.header + 8);
  if (!count || count > 200000) return [];
  if (fixed) return new Array(count).fill(fixed);
  const sizes = [];
  let at = stsz.start + stsz.header + 12;
  for (let i = 0; i < count; i++) {
    sizes.push(view.getUint32(at));
    at += 4;
  }
  return sizes;
}

function expandRuns(u8, box, count) {
  if (!box) return [];
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const runs = view.getUint32(box.start + box.header + 4);
  const out = [];
  let at = box.start + box.header + 8;
  for (let i = 0; i < runs && out.length < count; i++) {
    const n = view.getUint32(at);
    const delta = view.getUint32(at + 4);
    for (let j = 0; j < n && out.length < count; j++) out.push(delta);
    at += 8;
  }
  return out;
}

function sampleOffsets(u8, stsc, stco, sizes) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const wide = stco.type === 'co64';
  const chunkCount = view.getUint32(stco.start + stco.header + 4);
  const chunks = [];
  let at = stco.start + stco.header + 8;
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(wide ? Number(view.getBigUint64(at)) : view.getUint32(at));
    at += wide ? 8 : 4;
  }
  const runs = view.getUint32(stsc.start + stsc.header + 4);
  const map = [];
  at = stsc.start + stsc.header + 8;
  for (let i = 0; i < runs; i++) {
    map.push({
      first: view.getUint32(at),
      count: view.getUint32(at + 4),
    });
    at += 12;
  }
  const offsets = [];
  let sample = 0;
  for (let chunk = 1; chunk <= chunks.length && sample < sizes.length; chunk++) {
    let per = map.length ? map[0].count : 1;
    for (const row of map) {
      if (row.first <= chunk) per = row.count;
    }
    let cursor = chunks[chunk - 1];
    for (let i = 0; i < per && sample < sizes.length; i++) {
      offsets.push(cursor);
      cursor += sizes[sample];
      sample += 1;
    }
  }
  if (sample !== sizes.length) return null;
  return offsets;
}

function syncSet(u8, stss, count) {
  const all = new Set();
  if (!stss) {
    for (let i = 1; i <= count; i++) all.add(i);
    return all;
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = view.getUint32(stss.start + stss.header + 4);
  let at = stss.start + stss.header + 8;
  for (let i = 0; i < n; i++) {
    all.add(view.getUint32(at));
    at += 4;
  }
  if (!all.size) all.add(1);
  return all;
}

function compositionOffsets(u8, ctts, count) {
  if (!ctts) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = u8[ctts.start + ctts.header];
  const runs = view.getUint32(ctts.start + ctts.header + 4);
  const out = [];
  let at = ctts.start + ctts.header + 8;
  for (let i = 0; i < runs && out.length < count; i++) {
    const n = view.getUint32(at);
    const offset = version === 1 ? view.getInt32(at + 4) : view.getUint32(at + 4);
    for (let j = 0; j < n && out.length < count; j++) out.push(offset);
    at += 8;
  }
  while (out.length < count) out.push(0);
  return out;
}

function zeroDuration(u8, box, kind) {
  const out = u8.slice(box.start, box.end);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const version = out[box.header];
  let at = 0;
  let width = 4;
  if (kind === 'mvhd') {
    at = version === 1 ? box.header + 24 : box.header + 16;
    width = version === 1 ? 8 : 4;
  } else if (kind === 'tkhd') {
    at = version === 1 ? box.header + 28 : box.header + 20;
    width = version === 1 ? 8 : 4;
  } else {
    at = version === 1 ? box.header + 24 : box.header + 16;
    width = version === 1 ? 8 : 4;
  }
  if (width === 8) view.setBigUint64(at, 0n);
  else view.setUint32(at, 0);
  return out;
}

function initSegment(parts) {
  const empty = u32(0);
  const stts = box('stts', concatParts([u32(0), empty]));
  const stsc = box('stsc', concatParts([u32(0), empty]));
  const stsz = box('stsz', concatParts([u32(0), u32(0), empty]));
  const stco = box('stco', concatParts([u32(0), empty]));
  const stbl = box('stbl', concatParts([parts.stsd, stts, stsc, stsz, stco]));
  const minf = box('minf', concatParts([parts.vmhd, parts.dinf, stbl]));
  const mdia = box('mdia', concatParts([parts.mdhd, parts.hdlr, minf]));
  const trak = box('trak', concatParts([parts.tkhd, mdia]));
  const trex = box('trex', wordBytes([0, parts.trackId, 1, 0, 0, 0]));
  const mvex = box('mvex', trex);
  const moov = box('moov', concatParts([parts.mvhd, trak, mvex]));
  const ftyp = box('ftyp', concatParts([
    ascii('isom'), u32(0), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'),
  ]));
  return concatParts([ftyp, moov]);
}

function moofBox(seq, trackId, base, samples) {
  const mfhdSize = 16;
  const tfhdSize = 16;
  const tfdtSize = 16;
  const trunSize = 8 + 12 + samples.length * 16;
  const trafSize = 8 + tfhdSize + tfdtSize + trunSize;
  const moofSize = 8 + mfhdSize + trafSize;
  const trunBody = new Uint8Array(12 + samples.length * 16);
  const view = new DataView(trunBody.buffer);
  view.setUint32(0, 0x00000F01);
  view.setUint32(4, samples.length);
  view.setInt32(8, moofSize + 8);
  let at = 12;
  for (const sample of samples) {
    view.setUint32(at, sample.duration);
    view.setUint32(at + 4, sample.size);
    view.setUint32(at + 8, sample.sync ? 0x02000000 : 0x01010000);
    view.setInt32(at + 12, sample.cto | 0);
    at += 16;
  }
  const mfhd = box('mfhd', wordBytes([0, seq]));
  const tfhd = box('tfhd', wordBytes([0x020000, trackId]));
  const tfdt = box('tfdt', wordBytes([0, base >>> 0]));
  const trun = box('trun', trunBody);
  const traf = box('traf', concatParts([tfhd, tfdt, trun]));
  return box('moof', concatParts([mfhd, traf]));
}

function mdatBox(payload) {
  return box('mdat', payload);
}

function wordBytes(words) {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  words.forEach((word, i) => view.setUint32(i * 4, word >>> 0));
  return out;
}

function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function ascii(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

function box(type, payload) {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(payload, 8);
  return out;
}

function concatParts(parts) {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
