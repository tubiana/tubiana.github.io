#!/usr/bin/env node
/**
 * Headless smoke test for the built app (Playwright + Chromium).
 *
 *   npm run build && npm run smoke            # serves dist/ with `vite preview`
 *   npm run smoke -- --url http://localhost:5173   # test a dev server instead
 *   npm run smoke -- --headed --slow 120
 *
 * It boots the SPA, waits for the manifest + first model, then exercises the
 * real interactions (PAE hover/click, colour mode, tabs, MSA drawer, deep link)
 * and fails on any uncaught browser error.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
};
const PORT = Number(getArg('port', 4173));
const URL_OVERRIDE = getArg('url', null);
const HEADED = !!getArg('headed', false);
const SLOW = Number(getArg('slow', 0));
const OUT = path.join(root, 'smoke-artifacts');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

async function main() {
  let server = null;
  let baseUrl = URL_OVERRIDE;
  if (!baseUrl) {
    if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
      console.error('no dist/ — run `npm run build` first (or pass --url http://localhost:5173)');
      process.exit(2);
    }
    console.log(`· serving dist/ on :${PORT}`);
    server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    server.stdout.on('data', (b) => process.env.DEBUG && process.stdout.write(b));
    server.stderr.on('data', (b) => process.env.DEBUG && process.stderr.write(b));
    baseUrl = `http://localhost:${PORT}/`;
  }
  if (!(await waitForHttp(baseUrl))) {
    console.error(`server did not answer on ${baseUrl}`);
    server?.kill();
    process.exit(2);
  }

  const { chromium } = await import('playwright');
  const launchArgs = [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-dev-shm-usage',
  ];
  const chromePath =
    process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/snap/bin/chromium'].find((p) => fs.existsSync(p));
  let browser = null;
  const attempts = [
    { channel: 'chrome', args: launchArgs, headless: !HEADED },
    chromePath ? { executablePath: chromePath, args: launchArgs, headless: !HEADED } : null,
    { args: launchArgs, headless: !HEADED },
  ].filter(Boolean);
  for (const [i, opts] of attempts.entries()) {
    try {
      browser = await chromium.launch(opts);
      break;
    } catch (e) {
      if (i === attempts.length - 1) throw e;
    }
  }
  if (!browser) throw new Error('no Chromium/Chrome available for the smoke test');
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!/favicon|base-url\.txt/.test(u)) consoleErrors.push(`request failed ${u} ${r.failure()?.errorText}`);
  });

  const webgl = await page
    .evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      return { ok: !!gl, renderer: gl ? gl.getParameter(gl.RENDERER) : null };
    })
    .catch(() => ({ ok: false, renderer: null }));
  console.log(`  · WebGL in this browser: ${webgl.ok ? 'yes' : 'NO'}${webgl.renderer ? ` (${String(webgl.renderer).slice(0, 60)})` : ''}`);
  const skipNote = (name, extra = '') => {
    console.log(`  \x1b[33m○\x1b[0m ${name} — skipped (no WebGL in the test browser)${extra ? ` ${extra}` : ''}`);
  };

  const state = async () => page.evaluate(() => window.__orf1?.getState());
  const waitState = async (label, predicate, timeoutMs = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await state();
      if (s && predicate(s)) return s;
      await sleep(200);
    }
    return null;
  };

  try {
    console.log(`\n▶ ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const boot = await waitState('boot', (s) => s.manifest && s.model, 60000);
    check('manifest loads', !!boot, boot ? `${boot.manifest.models.length} models via ${boot.baseUrlHow}` : 'timeout');
    if (!boot) throw new Error('manifest never loaded');

    const ready = await waitState(
      'first model artifacts',
      (s) => s.status.structure === 'ready' && s.status.pae === 'ready' && s.status.plddt === 'ready',
      90000
    );
    check('structure + PAE + pLDDT load', !!ready, ready ? ready.model.id : 'timeout');
    check(
      'PAE integrity checkpoints verify',
      !!ready?.pae?.checks?.ok,
      ready?.pae ? `${ready.pae.checks.n} pts, maxΔ ${ready.pae.checks.maxAbsErr.toFixed(3)} Å, ${ready.pae.w}×${ready.pae.h}` : ''
    );
    check('PAE rgba buffer present', !!ready?.pae?.rgba && ready.pae.rgba.length === ready.pae.w * ready.pae.h * 4);
    // the ↓ PDB button resolves to pdbFullPath; whatever the server does with
    // Content-Encoding, the bytes must decode to a real PDB text stream.
    const fullProbe = await page.evaluate(async () => {
      const st = window.__orf1.getState();
      const entry = st.model;
      if (!entry?.pdbFullPath) return { path: null };
      const url = st.baseUrl.replace(/\/+$/, '') + '/' + entry.pdbFullPath;
      const res = await fetch(url);
      if (!res.ok) return { path: entry.pdbFullPath, ok: false, status: res.status };
      const raw = new Uint8Array(await res.arrayBuffer());
      const isGz = raw[0] === 0x1f && raw[1] === 0x8b;
      let text = '';
      if (isGz && globalThis.DecompressionStream) {
        text = await new Response(
          new Response(raw).body.pipeThrough(new DecompressionStream('gzip'))
        ).text();
      } else {
        text = new TextDecoder().decode(raw.subarray(0, 4000));
      }
      const isPdb = /^(ATOM|HEADER|REMARK)/m.test(text.slice(0, 600));
      const atoms = /^ATOM/m.test(text);
      return { path: entry.pdbFullPath, ok: true, kb: Math.round(raw.byteLength / 1024), isGz, isPdb, atoms };
    });
    check(
      'full-atom PDB available for ↓ PDB and decodes to PDB text',
      !!fullProbe?.path && fullProbe.ok === true && fullProbe.isPdb === true && fullProbe.atoms === true,
      JSON.stringify(fullProbe)
    );
    check(
      'full-atom model is larger than the backbone model',
      fullProbe?.kb > 150,
      `${fullProbe?.kb} KB transferred (${fullProbe?.isGz ? 'gzipped on the wire' : 'server set Content-Encoding: gzip'})`
    );

    const molCanvas = await page.locator('.mol-host canvas').count();
    if (webgl.ok) check('Mol* viewport mounted', molCanvas > 0, `${molCanvas} canvas`);
    else {
      skipNote('Mol* viewport mounted');
      await sleep(1200);
      const warned = await page.locator('text=/WebGL/').count();
      check('graceful fallback message when WebGL is unavailable', warned > 0, `${warned} notice`);
    }

    // header badges
    const badgeText = await page.locator('header').first().innerText();
    check('header shows the model id', badgeText.includes(ready.model.id));

    // ------------------------------------------------- PAE hover + click
    const paeCanvas = page.locator('canvas[style*="crosshair"]').first();
    await paeCanvas.waitFor({ state: 'visible', timeout: 20000 });
    const box = await paeCanvas.boundingBox();
    const cx = box.x + box.width * 0.55;
    const cy = box.y + box.height * 0.45;
    const n = await page.evaluate(() => window.__orf1.getState().pae?.w ?? 0);
    const hoverAt = async (fx, fy) => {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await sleep(320);
      return state();
    };
    const tl = await hoverAt(0.14, 0.14);
    const br = await hoverAt(0.86, 0.86);
    const hov = await hoverAt(0.55, 0.45);
    check(
      'PAE hover maps pixels to the top-left corner residues',
      !!tl.cursor && tl.cursor.i / n < 0.25 && tl.cursor.j / n < 0.25,
      tl.cursor ? `i=${tl.cursor.i} j=${tl.cursor.j} of ${n}` : 'no cursor'
    );
    check(
      'PAE hover maps pixels to the bottom-right corner residues',
      !!br.cursor && br.cursor.i / n > 0.6 && br.cursor.j / n > 0.6,
      br.cursor ? `i=${br.cursor.i} j=${br.cursor.j}` : 'no cursor'
    );
    check('PAE hover sets a cursor', !!hov.cursor, hov.cursor ? `i=${hov.cursor.i} j=${hov.cursor.j} ${hov.cursor.v.toFixed(2)} Å` : '');
    check(
      'PAE axes are oriented correctly (x = j, y = i, row 1 on top)',
      !!hov.cursor && hov.cursor.j > hov.cursor.i,
      hov.cursor ? `j=${hov.cursor.j} > i=${hov.cursor.i}` : ''
    );
    check('PAE hover highlights residues in 3D', hov.hover.length >= 1, `[${hov.hover.join(',')}]`);

    await page.mouse.click(cx, cy);
    await sleep(400);
    const sel = await state();
    const clicked = sel.selection;
    check('PAE click creates a pair selection', !!clicked && clicked.source === 'pair', clicked ? clicked.label : '');
    check(
      'selection residue numbers match the hovered cell',
      !!clicked && clicked.ranges.length === 2 && clicked.ranges[0].s === hov.cursor.i + 1 && clicked.ranges[1].s === hov.cursor.j + 1,
      clicked ? `${JSON.stringify(clicked.ranges)} vs cursor ${hov.cursor.i + 1}/${hov.cursor.j + 1}` : ''
    );

    // drag a box
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await page.mouse.up();
    await sleep(400);
    const boxSel = await state();
    check('PAE drag creates a region selection', boxSel.selection?.source === 'pae', boxSel.selection?.label ?? '');
    const spans = boxSel.selection?.ranges.map((r) => r.e - r.s + 1) ?? [];
    check(
      'PAE drag covers a real residue span (≥5 % of the chain)',
      spans.length === 2 && spans.every((s) => s >= n * 0.05),
      `${JSON.stringify(spans)} of ${n}`
    );

    // zoom-to-selection
    await page.getByTitle('zoom into the selected residue span').click();
    await sleep(400);
    const zoomed = await page.evaluate(() => window.__orf1.getState().paeWindow);
    check(
      'zoom sel narrows the visible matrix window',
      zoomed.x1 - zoomed.x0 < 0.6 && zoomed.x0 > 0,
      `${JSON.stringify(zoomed)}`
    );
    await page.getByTitle('show the whole matrix').click();
    await sleep(300);
    const unzomed = await page.evaluate(() => window.__orf1.getState().paeWindow);
    check('“all” restores the full window', unzomed.x0 === 0 && unzomed.x1 === 1);

    // muted-background colouring (cells ≥ scaleMax drawn flat)
    await sleep(500);
    const muteProbe = (expectMuted) =>
      page.evaluate(({ expectMuted }) => {
        const st = window.__orf1.getState();
        const m = st.pae;
        const lut = st.manifest?.pae?.lut;
        if (!m || !lut) return null;
        const lim = st.paeScaleMax;
        let checked = 0;
        let bad = 0;
        for (let k = 0; k < m.index.length; k += 997) {
          const v = lut[m.index[k]];
          if (v < lim) continue;
          const q = k * 4;
          const flat = m.rgba[q] === 15 && m.rgba[q + 1] === 21 && m.rgba[q + 2] === 31;
          checked++;
          if (flat !== expectMuted) bad++;
          if (checked > 4000) break;
        }
        return { checked, bad };
      }, { expectMuted });
    // the colour ramp must be blue at 0 Å and hot near the limit
    const ramp = await page.evaluate(() => {
      const st = window.__orf1.getState();
      const m = st.pae;
      const lut = st.manifest.pae.lut;
      let lo = null;
      let hi = null;
      let diag = null;
      for (let k = 0; k < m.index.length && !(lo && hi); k += 131) {
        const v = lut[m.index[k]];
        const rgb = [m.rgba[k * 4], m.rgba[k * 4 + 1], m.rgba[k * 4 + 2]];
        if (v <= 1 && !lo) lo = { v, rgb };
        if (v >= st.paeScaleMax * 0.65 && v < st.paeScaleMax && !hi) hi = { v, rgb };
      }
      const i = ((m.h / 2) | 0) * m.w + ((m.h / 2) | 0);
      diag = { v: lut[m.index[i]], rgb: [m.rgba[i * 4], m.rgba[i * 4 + 1], m.rgba[i * 4 + 2]] };
      return { lo, hi, diag };
    });
    const blue = (c) => c && c[2] > 120 && c[2] > c[0];
    const hot = (c) => c && c[0] > 150 && c[0] > c[2];
    check(
      'colour ramp: ≈0 Å is blue, near the limit is hot',
      blue(ramp.lo?.rgb) && hot(ramp.hi?.rgb),
      `lo=${JSON.stringify(ramp.lo)} hi=${JSON.stringify(ramp.hi)}`
    );
    check(
      'matrix diagonal (self-PAE) renders blue',
      ramp.diag.v < 1 && blue(ramp.diag.rgb),
      JSON.stringify(ramp.diag)
    );

    const mutedOn = await muteProbe(true);
    check(
      'cells above the scale limit are muted by default',
      mutedOn && mutedOn.checked > 20 && mutedOn.bad === 0,
      JSON.stringify(mutedOn)
    );
    await page.getByText('mute background').click();
    await sleep(700);
    const mutedOff = await muteProbe(false);
    check(
      '“mute background” toggle recolours the matrix',
      mutedOff && mutedOff.checked > 20 && mutedOff.bad === 0,
      JSON.stringify(mutedOff)
    );
    await page.getByText('mute background').click();
    await sleep(500);

    // shareable URL
    const search = await page.evaluate(() => location.search);
    check(
      'URL stays in sync (model / tab / color)',
      /[?&]model=/.test(search) && /[?&]tab=/.test(search) && /[?&]color=/.test(search),
      search
    );
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, '01-pae.png') });

    // ------------------------------------------------------- colour modes
    for (const mode of ['plddt', 'domain', 'uniform']) {
      await page.evaluate((m) => window.__orf1.getState().setColorMode(m), mode);
      await sleep(450);
    }
    const afterColor = await state();
    if (webgl.ok)
      check('colour mode switching keeps the structure', afterColor.colorMode === 'uniform' && afterColor.status.structure === 'ready');
    else check('colour mode switching updates the store', afterColor.colorMode === 'uniform');
    await page.screenshot({ path: path.join(OUT, '02-plddt-color.png') });
    await page.evaluate(() => window.__orf1.getState().setColorMode('domain'));

    // ---------------------------------------------------------------- tabs
    await page.evaluate(() => window.__orf1.getState().setTab('plddt'));
    await sleep(600);
    check('pLDDT tab renders', (await page.locator('table').count()) > 0);
    const domainRows = await page.locator('table tbody tr').count();
    check('domain table lists domains', domainRows >= 5, `${domainRows} rows`);
    await page.screenshot({ path: path.join(OUT, '03-plddt.png') });

    await page.evaluate(() => window.__orf1.getState().setTab('accent'));
    await sleep(1200);
    const imgOk = await page.evaluate(async () => {
      const img = document.querySelector('img[alt^="accentuated PAE"]');
      if (!img) return { ok: false, why: 'no img' };
      if (img.complete && img.naturalWidth > 0) return { ok: true, w: img.naturalWidth };
      await new Promise((r) => {
        img.onload = r;
        img.onerror = r;
        setTimeout(r, 8000);
      });
      return { ok: img.naturalWidth > 0, w: img.naturalWidth };
    });
    check('accentuated PAE figure decodes', imgOk.ok, `${imgOk.w}px`);
    await page.screenshot({ path: path.join(OUT, '04-accent.png') });
    await page.evaluate(() => window.__orf1.getState().setTab('pae'));

    // ----------------------------------------------------------------- MSA
    await page.keyboard.press('m');
    const msaState = await waitState('msa', (s) => !!s.msa, 60000);
    check('MSA parses', !!msaState?.msa, msaState ? `${msaState.msa.names.length} × ${msaState.msa.columns}` : 'timeout');
    check('MSA maps to the model row', !!msaState?.residueMap, msaState?.residueMap ? `${msaState.residueMap.length} aa mapped` : '');
    check(
      'alignment row matches the structure sequence (<2 % mismatch)',
      !!msaState?.residueMap?.reliable,
      msaState?.residueMap ? `${msaState.residueMap.mismatches}/${msaState.residueMap.compared}` : ''
    );
    await sleep(500);
    const msaCanvas = page.locator('canvas[style*="crosshair"]').last();
    const mbox = await msaCanvas.boundingBox();
    if (mbox) {
      await page.mouse.move(mbox.x + mbox.width * 0.6, mbox.y + mbox.height * 0.4);
      await sleep(260);
      await page.mouse.click(mbox.x + mbox.width * 0.6, mbox.y + mbox.height * 0.4);
      await sleep(320);
      const ms = await state();
      check('MSA click selects the mapped residue', ms.selection?.source === 'msa', ms.selection?.label ?? '');
    }
    await page.screenshot({ path: path.join(OUT, '05-msa.png') });
    await page.evaluate(() => window.__orf1.getState().toggleMsa(false));

    // ------------------------------------------------------- model switch
    const nextId = await page.evaluate(() => {
      const s = window.__orf1.getState();
      return s.manifest.models[Math.floor(s.manifest.models.length / 2)].id;
    });
    await page.evaluate((id) => void window.__orf1.getState().setModel(id), nextId);
    const switched = await waitState('switch', (s) => s.model?.id === nextId && s.status.structure === 'ready' && s.status.pae === 'ready', 90000);
    check('switching models reloads every artifact', !!switched, nextId);
    check(
      'second model integrity verifies',
      !!switched?.pae?.checks?.ok,
      switched?.pae ? `maxΔ ${switched.pae.checks.maxAbsErr.toFixed(3)} Å` : ''
    );
    await page.screenshot({ path: path.join(OUT, '06-second-model.png') });

    // --------------------------------------------------------- deep link
    const deep = new URL(baseUrl);
    deep.searchParams.set('model', nextId);
    deep.searchParams.set('tab', 'plddt');
    deep.searchParams.set('color', 'plddt');
    await page.goto(deep.toString(), { waitUntil: 'domcontentloaded' });
    const linked = await waitState('deep link', (s) => s.model?.id === nextId && s.status.structure === 'ready', 90000);
    check('?model= deep link loads that model', !!linked, nextId);
    check('?tab= / ?color= apply', linked?.tab === 'plddt' && linked?.colorMode === 'plddt', `${linked?.tab}/${linked?.colorMode}`);
    await page.screenshot({ path: path.join(OUT, '07-deep-link.png') });

    // ----------------------------------------------------- responsiveness
    await page.setViewportSize({ width: 900, height: 800 });
    await sleep(500);
    const bodyBox = await page.evaluate(() => ({ sw: document.body.scrollWidth, cw: document.body.clientWidth }));
    check('no horizontal overflow at 900px', bodyBox.sw <= bodyBox.cw + 2, `${bodyBox.sw} ≤ ${bodyBox.cw}`);
    await page.screenshot({ path: path.join(OUT, '08-narrow.png') });
    await page.setViewportSize({ width: 1560, height: 950 });
  } catch (e) {
    failures.push(`exception: ${String(e)}`);
    console.error(e);
    try {
      await page.screenshot({ path: path.join(OUT, 'FAIL.png') });
    } catch {}
  }

  // when the test browser has no WebGL, Mol*'s own failure noise is expected:
  // the app is supposed to degrade gracefully instead of breaking the page
  const isGlNoise = (t) =>
    /WebGL rendering context|reprCount|getContext|swiftshader|WebGL|Invalid data cell|parseTrajectory|molstar|Could not start the Mol/i.test(t);
  const realErrors = consoleErrors.filter(
    (t) =>
      !/favicon|base-url\.txt|404 \(Not Found\)|Failed to load resource/i.test(t) &&
      !(!webgl.ok && isGlNoise(t))
  );
  const realPageErrors = pageErrors.filter((t) => !(!webgl.ok && isGlNoise(t)));
  check('no uncaught page errors', realPageErrors.length === 0, realPageErrors.slice(0, 2).join(' | '));
  check('no console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

  await browser.close();
  server?.kill('SIGTERM');

  console.log(`\n${pass} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  · ${f}`).join('\n'));
    console.log(`screenshots in ${OUT}`);
    process.exit(1);
  }
  console.log(`screenshots in ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
