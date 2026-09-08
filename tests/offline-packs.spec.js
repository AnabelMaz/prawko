const { test, expect } = require('@playwright/test');

async function stubPacksHost(page) {
  await page.route('**/local.json', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/js/data.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace(
        /export let MEDIA_BASE = [^;]+;/,
        "export let MEDIA_BASE = 'https://cdn.example.test/prawko';"
      );
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body,
    });
  });
}

test.describe('Offline zip packs', () => {
  test('reads stored and deflate zip entries', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const names = await page.evaluate(async () => {
      const { forEachZipFile } = await import(new URL('./js/zip.js', location.href).href);

      const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
      const u32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
      const concat = (parts) => {
        const size = parts.reduce((n, p) => n + p.length, 0);
        const out = new Uint8Array(size);
        let o = 0;
        for (const p of parts) {
          out.set(p, o);
          o += p.length;
        }
        return out;
      };
      const local = (name, payload, method, uncompSize) => {
        const nameB = new TextEncoder().encode(name);
        return concat([
          new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
          u16(20),
          u16(0x800),
          u16(method),
          u16(0),
          u16(0),
          u32(0),
          u32(payload.length),
          u32(uncompSize),
          u16(nameB.length),
          u16(0),
          nameB,
          payload,
        ]);
      };

      const storedBody = new TextEncoder().encode('hello-stored');
      const stored = local('img/stored.webp', storedBody, 0, storedBody.length);

      const raw = new TextEncoder().encode('hello-deflate');
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      const deflated = local('vid/clip.mp4', compressed, 8, raw.length);
      const zip = concat([stored, deflated, new Uint8Array([0x50, 0x4b, 0x01, 0x02])]);

      const found = [];
      const progress = [];
      await forEachZipFile(zip.buffer, async (name, bytes) => {
        found.push({ name, text: new TextDecoder().decode(bytes) });
      }, (done, total) => progress.push({ done, total }));
      return { found, progress };
    });
    expect(names.found).toEqual([
      { name: 'img/stored.webp', text: 'hello-stored' },
      { name: 'vid/clip.mp4', text: 'hello-deflate' },
    ]);
    expect(names.progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  test('pack download keeps the old per-file function and caches unzipped media', async ({ page }) => {
    await stubPacksHost(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');

    const payload = new TextEncoder().encode('pack-bytes');
    const zipAndHash = await page.evaluate(async (arr) => {
      const data = new Uint8Array(arr);
      const nameB = new TextEncoder().encode('img/pack-test.webp');
      const u16 = (n) => [n & 255, (n >> 8) & 255];
      const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
      const zip = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04,
        ...u16(20),
        ...u16(0x800),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(nameB.length),
        ...u16(0),
        ...nameB,
        ...data,
        0x50, 0x4b, 0x01, 0x02,
      ]);
      const hash = await crypto.subtle.digest('SHA-256', zip);
      const sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return { zip: [...zip], sha256 };
    }, [...payload]);

    await page.route('https://pub-e8e3a36b9ab44034913636d87ee3f0ee.r2.dev/manifest.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema: 1,
          packs: {
            tiny: {
              id: 'tiny',
              file: 'tiny.zip',
              files: 1,
              support: ['PT'],
              missing: [],
              sha256: zipAndHash.sha256,
              bytes: zipAndHash.zip.length,
            },
          },
          categories: { PT: ['tiny'] },
        }),
      });
    });
    await page.route('https://pub-e8e3a36b9ab44034913636d87ee3f0ee.r2.dev/tiny.zip', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        body: Buffer.from(zipAndHash.zip),
      });
    });

    const result = await page.evaluate(async () => {
      const mod = await import(new URL('./js/offline.js', location.href).href);
      const { getMediaUrls } = await import(new URL('./js/data.js', location.href).href);
      const { OFFLINE_DOWNLOAD } = await import(new URL('./js/data.js', location.href).href);
      const keepOld = typeof mod.downloadCategoryMediaFromFiles === 'function'
        && OFFLINE_DOWNLOAD === 'packs';
      const downloaded = await mod.downloadCategoryMediaFromPacks('PT');
      const cache = await caches.open('prawko-offline-media-v1');
      const urls = getMediaUrls('pack-test.webp', 'image');
      let cached = false;
      for (const url of urls) {
        if (await cache.match(url) || await cache.match(new Request(url, { mode: 'cors' }))) {
          cached = true;
          break;
        }
      }
      return {
        keepOld,
        success: downloaded.success,
        cached,
      };
    });

    expect(result.keepOld).toBe(true);
    expect(result.success).toBe(true);
    expect(result.cached).toBe(true);
  });

  test('combined pack progress splits each zip 50/50 and keeps the coverage floor', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { combinedPackProgress } = await import(new URL('./js/offline.js', location.href).href);
      const round = (...args) => Math.round(combinedPackProgress(...args));
      return {
        from0download: round(0, [100], 0, 1, 0),
        from0unpacked: round(0, [100], 0, 1, 1),
        from98download: round(98, [100], 0, 1, 0),
        from98unpacked: round(98, [100], 0, 1, 1),
        twoPacksFirstDone: round(0, [100, 100], 0, 1, 1),
        twoPacksSecondStart: round(0, [100, 100], 1, 0, 0),
      };
    });
    expect(result.from0download).toBe(50);
    expect(result.from0unpacked).toBe(100);
    expect(result.from98download).toBe(99);
    expect(result.from98unpacked).toBe(100);
    expect(result.twoPacksFirstDone).toBe(50);
    expect(result.twoPacksSecondStart).toBe(50);
  });

  test('pack download reports ~50% after the zip and 100% only after unpack', async ({ page }) => {
    await stubPacksHost(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');

    const payload = new TextEncoder().encode('pack-progress');
    const zipAndHash = await page.evaluate(async (arr) => {
      const data = new Uint8Array(arr);
      const nameB = new TextEncoder().encode('img/pack-progress.webp');
      const u16 = (n) => [n & 255, (n >> 8) & 255];
      const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
      const zip = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04,
        ...u16(20),
        ...u16(0x800),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(nameB.length),
        ...u16(0),
        ...nameB,
        ...data,
        0x50, 0x4b, 0x01, 0x02,
      ]);
      const hash = await crypto.subtle.digest('SHA-256', zip);
      const sha256 = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return { zip: [...zip], sha256 };
    }, [...payload]);

    await page.route('https://pub-e8e3a36b9ab44034913636d87ee3f0ee.r2.dev/manifest.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema: 1,
          packs: {
            tiny: {
              id: 'tiny',
              file: 'tiny.zip',
              files: 1,
              support: ['PT'],
              missing: [],
              sha256: zipAndHash.sha256,
              bytes: zipAndHash.zip.length,
            },
          },
          categories: { PT: ['tiny'] },
        }),
      });
    });
    await page.route('https://pub-e8e3a36b9ab44034913636d87ee3f0ee.r2.dev/tiny.zip', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        body: Buffer.from(zipAndHash.zip),
      });
    });

    const ticks = await page.evaluate(async () => {
      const mod = await import(new URL('./js/offline.js', location.href).href);
      const seen = [];
      await mod.downloadCategoryMediaFromPacks('PT', (done, total) => {
        seen.push(Math.round((done / total) * 100));
      });
      return seen;
    });

    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[ticks.length - 1]).toBe(100);
    const floor = ticks[0];
    const beforeDone = ticks.slice(0, -1);
    expect(Math.max(...beforeDone)).toBeLessThan(100);
    const mid = Math.round(floor + (100 - floor) * 0.5);
    expect(beforeDone.some((pct) => Math.abs(pct - mid) <= 2)).toBe(true);
  });
});

test.describe('Offline cache matches B2 URL by media tail', () => {
  test('pack stored as local media/vid still hits the CDN path', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const hit = await page.evaluate(async () => {
      const cache = await caches.open('prawko-offline-media-v1');
      const name = `tail-hit-${Date.now()}.mp4`;
      const local = new URL(`media/vid/${name}`, location.href).href;
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      await cache.put(
        new Request(local, { mode: 'same-origin' }),
        new Response(payload, { headers: { 'Content-Type': 'video/mp4' } }),
      );
      const tailOf = (href) => {
        try {
          const m = new URL(href, location.href).pathname.match(/\/(vid|img)\/[^/]+$/i);
          return m ? m[0].toLowerCase() : '';
        } catch {
          return '';
        }
      };
      const cdn = `https://f003.backblazeb2.com/file/prawko-maz/vid/${name}`;
      const want = tailOf(cdn);
      for (const req of await cache.keys()) {
        if (tailOf(req.url) !== want) continue;
        const res = await cache.match(req);
        const buf = new Uint8Array(await res.arrayBuffer());
        await cache.delete(req);
        return { len: buf.length, first: buf[0], tail: want };
      }
      return null;
    });
    expect(hit).toBeTruthy();
    expect(hit.len).toBe(5);
    expect(hit.first).toBe(1);
    expect(hit.tail).toMatch(/\/vid\/tail-hit-\d+\.mp4$/);
  });
});
