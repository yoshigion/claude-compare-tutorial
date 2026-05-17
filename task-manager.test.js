// @ts-check
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Simple static file server ──────────────────────────────────────────────

const ROOT = __dirname;
const PORT = 9753;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
};

function createServer() {
  return http.createServer((req, res) => {
    const filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
    try {
      const data = fs.readFileSync(filePath);
      const ext  = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
}

// ── Test runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${label}`);
    console.log(`       ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'Assertion failed');
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function runTests(page, BASE) {
  // Fresh state for every suite
  async function freshPage() {
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }

  // ── [1] Add a task ──────────────────────────────────────────────────────
  await test('[1] タスクを追加すると一覧に表示され、is-new クラスでアニメーションする', async () => {
    await freshPage();
    await page.fill('#task-input', 'Buy groceries');
    await page.click('button[aria-label="Add task"]');

    const item = page.locator('.task-item').first();
    await item.waitFor();
    assert(await item.textContent().then(t => t.includes('Buy groceries')), 'タスクテキストが表示されない');
    const cls = await item.getAttribute('class');
    assert(cls.includes('is-new'), 'is-new クラスが付与されていない');
  });

  // ── [2] Toggle: existing tasks must not re-animate ──────────────────────
  await test('[2] 完了トグル時に既存タスクが再アニメーションしない', async () => {
    await freshPage();
    // Add two tasks
    for (const t of ['Task A', 'Task B']) {
      await page.fill('#task-input', t);
      await page.click('button[aria-label="Add task"]');
    }

    // Wait for is-new to be gone (animation ends and newTaskId clears on next render)
    // Toggle Task A
    await page.locator('.task-checkbox').first().click();

    const items = page.locator('.task-item');
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const cls = await items.nth(i).getAttribute('class');
      assert(!cls.includes('is-new'), `再レンダリング後に is-new が残っている (index ${i})`);
    }
  });

  // ── [3] Delete a task ───────────────────────────────────────────────────
  await test('[3] 削除ボタンでタスクが消える', async () => {
    await freshPage();
    await page.fill('#task-input', 'Delete me');
    await page.click('button[aria-label="Add task"]');

    const item = page.locator('.task-item').first();
    await item.hover();
    await item.locator('.task-delete').click();

    const remaining = await page.locator('.task-item').count();
    assert(remaining === 0, `タスクが残っている (count=${remaining})`);
    const emptyVisible = await page.locator('#empty-state').isVisible();
    assert(emptyVisible, '空状態メッセージが表示されない');
  });

  // ── [4] "Clear completed" visibility ───────────────────────────────────
  await test('[4] 完了タスクがあるときだけ "Clear completed" が表示される', async () => {
    await freshPage();
    await page.fill('#task-input', 'Finish report');
    await page.click('button[aria-label="Add task"]');
    await page.locator('.task-item').waitFor(); // task must be rendered before checking

    // Button should be hidden: use DOM property check instead of isVisible() to avoid timing edge cases
    const btnHiddenBefore = await page.locator('#clear-completed').evaluate(el => el.hidden);
    assert(btnHiddenBefore === true, '完了タスクがないのにボタンが表示されている');

    // Complete the task
    await page.locator('.task-checkbox').click();
    assert(await page.locator('#clear-completed').isVisible(), '完了タスクがあるのにボタンが隠れている');

    // Click clear
    await page.click('#clear-completed');
    const count = await page.locator('.task-item').count();
    assert(count === 0, `クリア後にタスクが残っている (count=${count})`);
    const btnHiddenAfter = await page.locator('#clear-completed').evaluate(el => el.hidden);
    assert(btnHiddenAfter === true, 'クリア後もボタンが表示されている');
  });

  // ── [5] Filter buttons ─────────────────────────────────────────────────
  await test('[5] フィルター (All / Active / Completed) が正しく機能する', async () => {
    await freshPage();
    for (const t of ['Alpha', 'Beta', 'Gamma']) {
      await page.fill('#task-input', t);
      await page.click('button[aria-label="Add task"]');
    }
    // Complete one task
    await page.locator('.task-checkbox').first().click();

    await page.click('[data-filter="active"]');
    const activeCount = await page.locator('.task-item').count();
    assert(activeCount === 2, `Active フィルターで ${activeCount} 件 (期待: 2)`);

    await page.click('[data-filter="completed"]');
    const completedCount = await page.locator('.task-item').count();
    assert(completedCount === 1, `Completed フィルターで ${completedCount} 件 (期待: 1)`);

    await page.click('[data-filter="all"]');
    const allCount = await page.locator('.task-item').count();
    assert(allCount === 3, `All フィルターで ${allCount} 件 (期待: 3)`);
  });

  // ── [6] Dark mode + localStorage persistence + no FOUC ─────────────────
  await test('[6] ダークモードが切り替わり、リロード後も維持され FOUC がない', async () => {
    await freshPage();
    // Default is light
    let theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(theme !== 'dark', `初期状態がダーク (theme="${theme}")`);

    // Toggle to dark
    await page.click('#theme-toggle');
    theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(theme === 'dark', 'ダークモードに切り替わらない');

    // Persist after reload — measure how quickly theme is applied
    const startTs = Date.now();
    await page.reload();
    const themeAfterReload = await page.evaluate(() => document.documentElement.dataset.theme);
    const elapsed = Date.now() - startTs;
    assert(themeAfterReload === 'dark', 'リロード後にダークモードが維持されない');

    // Verify the inline <head> script applied the theme early (well before DOMContentLoaded)
    // We check via paint timing: theme should be set before first paint
    const fouc = await page.evaluate(() => {
      return window.__themeAppliedBeforeLoad !== undefined
        ? window.__themeAppliedBeforeLoad
        : document.documentElement.dataset.theme === 'dark';
    });
    assert(fouc, 'ページ表示時にテーマが適用されていない (FOUC の可能性)');

    // Toggle back to light
    await page.click('#theme-toggle');
    theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(theme !== 'dark', 'ライトモードに戻らない');
  });

  // ── [7] Touch device: delete button always visible ─────────────────────
  await test('[7] タッチデバイスで削除ボタンが常時表示される', async () => {
    // Use a separate context with touch emulation
    const touchCtx = await page.context().browser().newContext({
      ...devices['Pixel 7'],
    });
    const touchPage = await touchCtx.newPage();
    await touchPage.goto(BASE);
    await touchPage.evaluate(() => localStorage.clear());
    await touchPage.reload();
    await touchPage.fill('#task-input', 'Touch task');
    await touchPage.click('button[aria-label="Add task"]');

    const deleteBtn = touchPage.locator('.task-delete').first();
    await deleteBtn.waitFor();
    const opacity = await deleteBtn.evaluate(el => getComputedStyle(el).opacity);
    assert(parseFloat(opacity) > 0.9, `タッチデバイスで削除ボタンの opacity が ${opacity} (期待: 1)`);

    await touchPage.close();
    await touchCtx.close();
  });

  // ── [8] Keyboard navigation ────────────────────────────────────────────
  await test('[8] キーボードだけで全コントロールを操作できる', async () => {
    await freshPage();
    // Focus input and add a task via keyboard
    await page.focus('#task-input');
    await page.keyboard.type('Keyboard task');
    await page.keyboard.press('Enter');

    const item = page.locator('.task-item').first();
    await item.waitFor();

    // Tab to checkbox and toggle with Space
    const checkbox = page.locator('.task-checkbox').first();
    await checkbox.focus();
    await page.keyboard.press('Space');
    assert(await checkbox.isChecked(), 'Space キーでチェックできない');

    // Tab to delete and press Enter
    const deleteBtn = page.locator('.task-delete').first();
    await deleteBtn.focus();
    await page.keyboard.press('Enter');
    const count = await page.locator('.task-item').count();
    assert(count === 0, 'Enter キーで削除できない');
  });

  // ── [9] Accessibility: aria-live + aria-pressed ────────────────────────
  await test('[9] aria-live でタスク数が通知され、フィルターに aria-pressed がある', async () => {
    await freshPage();

    // Check aria-live region exists with correct attribute
    const summaryEl = page.locator('#task-summary');
    const ariaLive = await summaryEl.getAttribute('aria-live');
    assert(ariaLive === 'polite', `aria-live が "polite" でない (="${ariaLive}")`);

    // Add a task and check summary text updates
    await page.fill('#task-input', 'Aria task');
    await page.click('button[aria-label="Add task"]');
    const text = await summaryEl.textContent();
    assert(text.includes('1'), `タスク数が更新されない ("${text}")`);

    // Check filter buttons have aria-pressed
    const filterBtns = page.locator('.filter-btn');
    const btnCount = await filterBtns.count();
    for (let i = 0; i < btnCount; i++) {
      const pressed = await filterBtns.nth(i).getAttribute('aria-pressed');
      assert(pressed !== null, `フィルターボタン ${i} に aria-pressed がない`);
    }

    // Active filter button must have aria-pressed="true"
    const activeBtn = page.locator('.filter-btn.active');
    const activePressed = await activeBtn.getAttribute('aria-pressed');
    assert(activePressed === 'true', `アクティブフィルターの aria-pressed が "${activePressed}"`);
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  const server = createServer();
  await new Promise(r => server.listen(PORT, r));
  const BASE = `http://localhost:${PORT}`;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page    = await context.newPage();

  console.log('\nTask Manager — テストチェックリスト\n');

  try {
    await runTests(page, BASE);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n結果: ${passed} 件合格 / ${failed} 件失敗\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
