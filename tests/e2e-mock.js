const { chromium, devices } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3001';
const TEST_IMG = '/Users/qi/Desktop/AI漫画项目组/agent4-test-kit/assets/test.jpg';
// 1×1 像素 PNG(虚拟生图结果,cover绘制会放大填充格子)
const FAKE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const results = [];
function report(step, ok, detail = '') {
  results.push({ step, ok });
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 150)); });

  // ── 虚拟生图:拦截批量生图接口,不花一分钱 ──
  let hintDelivered = null;
  await page.route('**/api/generate-batch', async (route) => {
    const req = route.request().postDataJSON();
    // 验证分镜提示词已随请求进入生图链路(第2条修复的数据验证)
    hintDelivered = Array.isArray(req.panels) && req.panels.every(p => typeof p.visualPromptHint === 'string' && p.visualPromptHint.length > 10);
    const out = req.panels.map(p => ({ panelId: p.panelId, status: 'done', imageUrl: FAKE_PNG }));
    await new Promise(r => setTimeout(r, 800)); // 模拟生成耗时
    await route.fulfill({ json: { results: out } });
  });

  try {
    // 0. 清库
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('pf_onboarded_v1', '1'); });

    // 1. 建角色
    await page.goto(BASE + '/characters/new', { waitUntil: 'networkidle' });
    const chooserP = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('label[for="ref-upload"] span', { hasText: '选择图片' }).click();
    (await chooserP).setFiles(TEST_IMG);
    await page.waitForTimeout(2000);
    await page.getByPlaceholder('例如：云绯').fill('虚拟测试角');
    await page.getByText('下一步：确认特征锁定').click();
    await page.getByText('保存角色卡').waitFor({ timeout: 5000 });
    await page.getByText('保存角色卡').click();
    await page.waitForURL('**/create?character=*', { timeout: 8000 });
    report('建角色(上传+锁定+保存)', true);

    // 2. 创作(真实LLM,验证审核+剧情链路)
    await page.locator('textarea').fill('图书馆里她总是坐在窗边的位置，直到有一天位置上多了一张纸条');
    await page.getByText('AI 补全剧情 + 分镜').click();
    const confirmed = await page.getByText('剧情 + 分镜生成完成').waitFor({ timeout: 300000 }).then(() => true).catch(() => false);
    report('剧情+分镜生成(真实LLM)', confirmed);
    if (!confirmed) throw new Error('剧情生成失败,中止');
    report('剧情摘要默认展开可见', await page.getByText('收起 ▲').isVisible().catch(() => false));

    // 3. 确认 → 生图(虚拟)
    await page.getByText('确认，开始生成图片').click();
    await page.waitForURL('**/project/*/generate', { timeout: 5000 });
    const reviewOk = await page.getByText('稿件预览').waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    report('虚拟生图完成进入稿件预览', reviewOk);
    report('分镜提示词已传入生图链路(visualPromptHint)', hintDelivered === true, hintDelivered === null ? '接口未被调用' : '');
    const okText = await page.locator('text=/成功 \\d+ \\/ \\d+ 格/').textContent().catch(() => '');
    report('全格成功', okText.includes('4 / 4'), okText);

    // 4. 气泡编辑(canvas预览+样式)
    await page.getByText('编辑气泡').click();
    await page.locator('canvas').waitFor({ timeout: 5000 });
    await page.getByPlaceholder('输入对白文字').fill('是谁留下的纸条呢');
    await page.waitForTimeout(1000);
    const canvasRatio = await page.locator('canvas').evaluate(c => (c.height / c.width).toFixed(2));
    report('气泡预览canvas按导出格子比例渲染', canvasRatio === '1.33', `高宽比=${canvasRatio}(3:4项目应为1.33)`);
    await page.getByText('确认气泡，去导出').click();
    await page.waitForURL('**/export?project=*', { timeout: 5000 });

    // 5. 导出
    await page.getByText('免费导出（含水印）').click();
    const exportOk = await page.getByText('导出成功').waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    report('导出合成成功', exportOk);
    if (exportOk) {
      const dims = await page.locator('img[alt="导出结果"]').evaluate(img => ({ w: img.naturalWidth, h: img.naturalHeight }));
      report('导出尺寸为3:4竖图', Math.abs(dims.h / dims.w - 4 / 3) < 0.02, `${dims.w}×${dims.h}`);
      const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
      await page.getByText('下载图片').click();
      report('下载触发', !!(await dl));
    }

    // 6. 新功能:导出Tab直接进入显示作品列表+导出记录
    await page.goto(BASE + '/export', { waitUntil: 'networkidle' });
    report('导出Tab显示作品选择列表', await page.getByText('导出作品').first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
    const record = await page.getByText('已导出 1 次').isVisible().catch(() => false);
    report('显示历史导出记录(已导出1次)', record);
    // 点击作品能进入导出
    await page.locator('button.pf-card').first().click();
    await page.waitForURL('**/export?project=*', { timeout: 5000 });
    report('点击作品进入其导出页', true);

    // 7. 工作台/个人中心状态
    await page.goto(BASE + '/profile', { waitUntil: 'networkidle' });
    const stats = await page.locator('p.text-2xl').allTextContents();
    report('个人中心统计正确', stats[0] === '1' && stats[1] === '1', `作品=${stats[0]} 导出=${stats[1]}`);

  } catch (err) {
    report('流程中断', false, err.message.slice(0, 200));
  }

  console.log('\n── 页面报错 ──');
  console.log(consoleErrors.length ? consoleErrors.slice(0, 8).join('\n') : '(无)');
  console.log(`\n总计: ${results.filter(r => r.ok).length}/${results.length} 通过`);
  await browser.close();
})();
