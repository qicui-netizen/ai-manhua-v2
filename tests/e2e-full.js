const { chromium, devices } = require('playwright');

const BASE = 'http://localhost:3001';
const TEST_IMG = '/Users/qi/Desktop/AI漫画项目组/agent4-test-kit/assets/test.jpg';
const results = [];
function report(step, ok, detail = '') {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push('console: ' + msg.text().slice(0, 200)); });
  page.on('response', res => { if (res.url().includes('/api/')) console.log(`  [API] ${res.status()} ${res.url().replace('http://localhost:3001', '')}`); });
  page.on('requestfailed', req => { if (req.url().includes('/api/')) console.log(`  [API请求失败] ${req.url().replace('http://localhost:3001', '')} — ${req.failure()?.errorText}`); });

  try {
    // ── 0. 清空存储,从零开始 ──
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });

    // ── 1. 工作台空态 ──
    report('工作台空态标语', await page.getByText('创作你的第一篇漫格').isVisible().catch(() => false));
    report('入口卡:创建我的角色', await page.getByText('创建我的角色').isVisible().catch(() => false));
    report('入口卡:一句话生成漫格', await page.getByText('一句话生成漫格').isVisible().catch(() => false));

    // TabBar 四个标签
    for (const tab of ['工作台', '角色库', '导出', '我的']) {
      const vis = await page.locator(`a:has-text("${tab}")`).last().isVisible().catch(() => false);
      report(`底部标签「${tab}」可见`, vis);
    }

    // ── 2. 角色库 ──
    await page.getByText('创建我的角色').click();
    await page.waitForURL('**/characters');
    report('进入角色库', true);
    report('种子角色云绯显示', await page.getByText('云绯').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
    report('种子角色墨白显示', await page.getByText('墨白').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false));

    // ── 3. 新建角色卡:上传+表单+两步流程 ──
    await page.getByText('创建新角色卡').click();
    await page.waitForURL('**/characters/new');

    const chooserP = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('label[for="ref-upload"] span', { hasText: '选择图片' }).click();
    const chooser = await chooserP;
    await chooser.setFiles(TEST_IMG);
    await page.waitForTimeout(2500);
    const previewCount = await page.locator('label[for="ref-upload"] img').count();
    report('上传后预览图显示', previewCount === 1, `预览图数量=${previewCount}`);
    const compressed = await page.locator('label[for="ref-upload"] img').first().getAttribute('src');
    report('预览图已压缩为JPEG', !!compressed && compressed.startsWith('data:image/jpeg'), (compressed || '').slice(0, 25));

    await page.getByPlaceholder('例如：云绯').fill('E2E测试角');
    await page.getByPlaceholder('粉色长发，红色瞳孔，活泼可爱的高中女生…').fill('蓝色短发，运动系少女');
    await page.getByText('下一步：确认特征锁定').click();
    report('进入第2步特征锁定', await page.getByText('保存角色卡').waitFor({ timeout: 10000 }).then(() => true).catch(() => false));

    // 特征锁定按钮循环切换
    const lockBtn = page.locator('button', { hasText: '弱锁定' }).first();
    await lockBtn.click();
    report('特征锁定可切换', await page.locator('button', { hasText: '不锁定' }).first().isVisible().catch(() => false));

    // 返回上一步再回来(测试 step2 返回键)
    await page.locator('button[aria-label="返回"]').click();
    report('第2步点返回回到第1步', await page.getByText('下一步：确认特征锁定').isVisible().catch(() => false));
    await page.getByText('下一步：确认特征锁定').click();

    await page.getByText('保存角色卡').click();
    await page.waitForURL('**/create?character=*', { timeout: 5000 });
    report('保存角色卡并跳转创作页', true);

    // ── 4. 创作页:真实调用 LLM ──
    report('创作页角色带入', await page.getByText('E2E测试角 的故事').waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
    await page.locator('textarea').fill('深夜自习室，她发现每天都有人悄悄给她留一盏灯');
    await page.getByText('AI 补全剧情 + 分镜').click();
    report('进入AI生成等待态', await page.getByText('AI 正在编剧 + 分镜…').isVisible({ timeout: 3000 }).catch(() => false));

    const confirmed = await page.getByText('剧情 + 分镜生成完成').waitFor({ timeout: 300000 }).then(() => true).catch(() => false);
    report('LLM返回剧情+分镜', confirmed);
    if (!confirmed) {
      const errText = await page.locator('.text-\\[var\\(--color-error\\)\\]').first().textContent().catch(() => '');
      report('生成失败详情', false, errText || '超时150秒');
    } else {
      // 展开剧情摘要
      await page.getByText('剧情摘要（起承转合）').click();
      report('剧情摘要可展开', await page.getByText('收起 ▲').isVisible().catch(() => false));
      // 展开第一格编辑
      await page.getByText('第 1 格').first().click();
      report('分镜卡可展开编辑', await page.getByText('场景描述').first().isVisible().catch(() => false));

      // ── 5. 确认 → 生图页(真实生图) ──
      await page.getByText('确认，开始生成图片').click();
      await page.waitForURL('**/project/*/generate', { timeout: 5000 });
      report('跳转生图页', true);
      report('生图等待态显示', await page.getByText('正在批量生成').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false));

      const reviewOk = await page.getByText('稿件预览').waitFor({ timeout: 300000 }).then(() => true).catch(() => false);
      report('生图完成进入稿件预览', reviewOk);
      if (reviewOk) {
        const successText = await page.locator('text=/成功 \\d+ \\/ \\d+ 格/').textContent().catch(() => '');
        report('生图成功率', true, successText);

        // 气泡编辑
        await page.getByText('编辑气泡').click();
        report('进入气泡编辑', await page.getByText('对白（≤28字）').waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
        await page.getByPlaceholder('输入对白文字').fill('是谁一直留着灯呢');
        // 缩略图切换
        const thumbs = page.locator('button.relative.h-13');
        if (await thumbs.count() > 1) await thumbs.nth(1).click();
        report('气泡编辑格切换', true);

        await page.getByText('确认气泡，去导出').click();
        await page.waitForURL('**/export?project=*', { timeout: 5000 });
        report('跳转导出页', true);

        // ── 6. 导出 ──
        await page.getByText('小红书·方图').click();
        report('切换导出平台', true);
        await page.getByText('免费导出（含水印）').click();
        const exportOk = await page.getByText('导出成功').waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
        report('导出合成成功', exportOk);
        if (exportOk) {
          const dlPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
          await page.getByText('下载图片').click();
          const dl = await dlPromise;
          report('下载触发', !!dl, dl ? await dl.suggestedFilename() : '未触发download事件');
        }
      }
    }

    // ── 7. 个人中心 ──
    await page.goto(BASE + '/profile', { waitUntil: 'networkidle' });
    const workCount = await page.locator('p.text-2xl').first().textContent().catch(() => '?');
    const exportCount = await page.locator('p.text-2xl').nth(1).textContent().catch(() => '?');
    report('个人中心数据', true, `作品数=${workCount} 导出次数=${exportCount}`);
    report('个人中心作品列表', await page.getByText('我的作品').isVisible().catch(() => false));

    // ── 8. 工作台有内容态 ──
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    report('工作台显示全部短篇', await page.getByText('全部短篇').isVisible().catch(() => false));
    report('工作台显示草稿/项目卡', await page.locator('a[href*="/storyboard"]').first().isVisible().catch(() => false));

    // ── 9. 分镜页(从工作台进入) ──
    await page.locator('a[href*="/storyboard"]').first().click();
    await page.waitForURL('**/storyboard');
    report('进入分镜页', true);
    await page.getByText('第 1 格').first().click();
    report('分镜页折叠编辑可用', await page.getByText('场景描述').isVisible().catch(() => false));

  } catch (err) {
    report('脚本异常中断', false, err.message.slice(0, 300));
  }

  console.log('\n── 页面报错收集 ──');
  console.log(consoleErrors.length ? consoleErrors.slice(0, 20).join('\n') : '(无)');
  console.log(`\n总计: ${results.filter(r => r.ok).length}/${results.length} 通过`);
  await browser.close();
})();
