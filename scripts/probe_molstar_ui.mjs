import { chromium } from 'playwright';
import { spawn } from 'child_process';
const port = 4179;
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
for (const adv of ['0', '1']) {
  await page.addInitScript((v) => localStorage.setItem('orf1.molstarAdvanced', v), adv);
  await page.goto(`http://127.0.0.1:${port}/?molui=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__orf1 && !!document.querySelector('.msp-plugin'), null, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  const info = await page.evaluate(() => {
    const p = window.__orf1.mol.plugin();
    const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; };
    return {
      showControls: p.layout.state.showControls,
      cls: document.querySelector('.msp-plugin-content')?.className,
      regions: [...document.querySelectorAll('.msp-layout-region')].map((e) => e.className.replace('msp-layout-region msp-layout-', '')),
      left: rect('.msp-layout-left'),
      leftPanelText: (document.querySelector('.msp-layout-left')?.innerText || '').slice(0, 120).replace(/\s+/g, ' '),
      right: rect('.msp-layout-right'),
      rightPanelText: (document.querySelector('.msp-layout-right')?.innerText || '').slice(0, 160).replace(/\s+/g, ' '),
      shell: (() => { const e = document.querySelector('.viewer-advanced'); if (!e) return null; const cs = getComputedStyle(e); return { z: cs.zIndex, overflow: cs.overflow, cls: e.className.slice(0, 60) }; })(),
      advancedButton: !!document.querySelector(".msp-viewport-controls [title='Toggle Controls Panel']"),
      themes: window.__orf1.mol.themes().filter((t) => t.startsWith('orf1')),
    };
  });
  console.log(`advanced=${adv} →`, JSON.stringify(info, null, 1));
}
await browser.close();
srv.kill('SIGTERM');
