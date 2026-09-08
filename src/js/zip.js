// zip.js — Read ZIP_STORED / DEFLATE (method 0 / 8) in the browser. No library.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const EXTRA_UNICODE_PATH = 0x7075;

function readU16(view, offset) {
  return view.getUint16(offset, true);
}

function readU32(view, offset) {
  return view.getUint32(offset, true);
}

function decodeName(bytes, utf8) {
  return new TextDecoder(utf8 ? 'utf-8' : 'iso-8859-1').decode(bytes);
}

function unicodePathFromExtra(extra) {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra[i] | (extra[i + 1] << 8);
    const size = extra[i + 2] | (extra[i + 3] << 8);
    i += 4;
    if (i + size > extra.length) break;
    if (id === EXTRA_UNICODE_PATH && size > 5) {
      return new TextDecoder('utf-8').decode(extra.subarray(i + 5, i + size));
    }
    i += size;
  }
  return null;
}

async function inflateRaw(compressed) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is not available');
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function listZipLocalFiles(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = readU32(view, offset);
    if (sig === SIG_CENTRAL || sig === SIG_EOCD) break;
    if (sig !== SIG_LOCAL) {
      throw new Error(`Invalid zip local header at ${offset}`);
    }
    const flags = readU16(view, offset + 6);
    const method = readU16(view, offset + 8);
    const compSize = readU32(view, offset + 18);
    const nameLen = readU16(view, offset + 26);
    const extraLen = readU16(view, offset + 28);
    if (flags & 0x8) {
      throw new Error('Zip data descriptors are not supported');
    }
    const nameStart = offset + 30;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLen);
    const extra = bytes.subarray(nameStart + nameLen, nameStart + nameLen + extraLen);
    const fromExtra = unicodePathFromExtra(extra);
    const name = (fromExtra || decodeName(nameBytes, (flags & 0x800) !== 0)).replace(/\\/g, '/');
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > bytes.length) {
      throw new Error(`Zip entry ${name} is truncated`);
    }
    offset = dataEnd;
    if (!name || name.endsWith('/')) continue;
    entries.push({
      name,
      method,
      compressed: bytes.subarray(dataStart, dataEnd),
    });
  }
  return entries;
}

/**
 * Call `onFile(path, bytes)` for each file. Directories are skipped.
 * `path` uses forward slashes (`img/foo.webp`).
 * Optional `onProgress(done, total)` runs after each file so unpack % can move.
 */
export async function forEachZipFile(buffer, onFile, onProgress) {
  const entries = listZipLocalFiles(buffer);
  const total = entries.length;
  let done = 0;
  for (const entry of entries) {
    let data;
    if (entry.method === 0) {
      data = entry.compressed.slice();
    } else if (entry.method === 8) {
      data = await inflateRaw(entry.compressed);
    } else {
      throw new Error(`Unsupported zip method ${entry.method} for ${entry.name}`);
    }
    await onFile(entry.name, data);
    done++;
    onProgress?.(done, total);
  }
}
