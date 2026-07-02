// 十种用户画像 · 全流程模拟测试(虚拟环境:剧情与生图接口全部mock,不产生任何API费用)
// 每个 persona 独立浏览器上下文(隔离localStorage),逐步记录卡点(失败/慢/报错)。
const { chromium, devices } = require('playwright');

const BASE = 'http://localhost:3001';
const TEST_IMG = '/Users/qi/Desktop/AI漫画项目组/agent4-test-kit/assets/test.jpg';
const FAKE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SLOW_MS = 6000; // 单步超过6秒记为"慢"卡点

const issues = []; // {persona, step, type: 'fail'|'slow'|'console', detail}
const summary = []; // {persona, pass, total}

function mkPanels(n) {
  const beats = ['起', '承', '转', '合'];
  return Array.from({ length: n }, (_, i) => ({
    panelId: i + 1,
    beat: beats[Math.min(Math.floor((i / n) * 4), 3)],
    scene: `测试场景第${i + 1}格【大格】`, camera: '中景·固定·平角',
    characterAction: '角色站立微笑', emotion: '平静',
    dialogue: i === 0 ? '你好呀' : '', caption: i === n - 1 ? '故事结束' : '',
    visualPromptHint: `anime style panel ${i + 1}, girl smiling, soft light, medium shot`,
    status: 'idle',
  }));
}

async function mockRoutes(context, { mockPlot = true } = {}) {
  await context.route('**/api/generate-batch', async (route) => {
    const req = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 600));
    await route.fulfill({ json: { results: req.panels.map((p) => ({ panelId: p.panelId, status: 'done', imageUrl: FAKE_PNG })) } });
  });
  if (mockPlot) {
    await context.route('**/api/plot-and-storyboard', async (route) => {
      const req = route.request().postDataJSON();
      const n = req.panelCount || 4;
      await new Promise((r) => setTimeout(r, 800));
      // 保真:自写剧情模式(lockedExpandedPlot)时服务端会原样返回用户剧情(含空beats),mock同样遵守
      const expandedPlot = req.lockedExpandedPlot || {
        toneLabel: req.tone || '治愈', conflict: '小冲突', scene: '教室', charactersState: '平静',
        plot: '这是一段用于测试的虚拟剧情,完整走通链路即可。', keyDialogues: ['你好呀'], dialogueCount: '1/8对',
        ending: '圆满', beats: { 起: '开始', 承: '发展', 转: '转折', 合: '结尾' }, riskNotes: [],
      };
      await route.fulfill({
        json: { status: 'ok', storyTitle: '虚拟测试短篇', expandedPlot, panels: mkPanels(n), riskNotes: [] },
      });
    });
  }
}

// 步骤执行器:记录失败与慢
async function step(persona, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    if (ms > SLOW_MS) issues.push({ persona, step: name, type: 'slow', detail: `耗时${(ms / 1000).toFixed(1)}秒` });
    return true;
  } catch (err) {
    issues.push({ persona, step: name, type: 'fail', detail: err.message.split('\n')[0].slice(0, 160) });
    return false;
  }
}

// 常用操作
async function createCharacter(page, { withImage = true, name = '测试角' } = {}) {
  await page.goto(BASE + '/characters/new', { waitUntil: 'networkidle' });
  if (withImage) {
    const ch = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('label[for="ref-upload"] span', { hasText: '选择图片' }).click();
    (await ch).setFiles(TEST_IMG);
    await page.waitForTimeout(1800);
  }
  await page.getByPlaceholder('例如：云绯').fill(name);
  await page.getByText('下一步：确认特征锁定').click();
  await page.getByText('保存角色卡').waitFor({ timeout: 5000 });
  await page.getByText('保存角色卡').click();
  await page.waitForURL('**/create?character=*', { timeout: 8000 });
}

async function runCreateFlow(page, { synopsis = '一段温柔的小故事', template = null, platform = null } = {}) {
  await page.locator('textarea').fill(synopsis);
  if (template) await page.getByText(template, { exact: true }).click();
  if (platform) await page.locator(`.pf-chip:has-text("${platform}")`).click();
  await page.getByText('AI 补全剧情 + 分镜').click();
  await page.getByText('剧情 + 分镜生成完成').waitFor({ timeout: 20000 });
}

async function confirmAndGenerate(page) {
  await page.getByText('确认，开始生成图片').click();
  await page.waitForURL('**/project/*/generate', { timeout: 8000 });
  await page.getByText('稿件预览').waitFor({ timeout: 20000 });
}

async function exportCurrent(page, expectRatio = null) {
  await page.getByText('免费导出（含水印）').click();
  await page.getByText('导出成功').waitFor({ timeout: 30000 });
  if (expectRatio) {
    const dims = await page.locator('img[alt="导出结果"]').evaluate((img) => img.naturalHeight / img.naturalWidth);
    if (Math.abs(dims - expectRatio) > 0.05) throw new Error(`导出比例${dims.toFixed(2)}≠预期${expectRatio}`);
  }
}

// ── 十种用户画像 ──────────────────────────────────────────────
const PERSONAS = [
  {
    name: 'P1小白新手(零图零经验一路默认)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P1', '首次访问自动引导到建角色', async () => {
        await page.goto(BASE, { waitUntil: 'networkidle' });
        await page.waitForURL('**/characters/new', { timeout: 6000 });
      })) pass++;
      total++; if (await step('P1', '不传图直接建角色(占位头像兜底)', async () => {
        await page.getByPlaceholder('例如：云绯').fill('新手角');
        await page.getByText('下一步：确认特征锁定').click();
        await page.getByText('未上传参考图').waitFor({ timeout: 4000 });
        await page.getByText('保存角色卡').click();
        await page.waitForURL('**/create?character=*', { timeout: 8000 });
      })) pass++;
      total++; if (await step('P1', '示例梗概一键填入并生成', async () => {
        await page.locator('button:has-text("下雨天她躲在屋檐下")').click();
        await page.getByText('AI 补全剧情 + 分镜').click();
        await page.getByText('剧情 + 分镜生成完成').waitFor({ timeout: 20000 });
      })) pass++;
      total++; if (await step('P1', '默认设置直出到导出', async () => {
        await confirmAndGenerate(page);
        await page.getByText('导出稿件 →').click();
        await page.waitForURL('**/export?project=*');
        await exportCurrent(page, 4 / 3);
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P2认真创作者(多图+锁定+改分镜)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P2', '上传2张删1张再调锁定', async () => {
        await page.goto(BASE + '/characters/new', { waitUntil: 'networkidle' });
        const ch1 = page.waitForEvent('filechooser', { timeout: 5000 });
        await page.locator('label[for="ref-upload"] span', { hasText: '选择图片' }).click();
        (await ch1).setFiles([TEST_IMG, TEST_IMG]);
        await page.waitForTimeout(2500);
        const cnt = await page.locator('label[for="ref-upload"] img').count();
        if (cnt !== 2) throw new Error(`上传2张实际${cnt}张`);
        await page.locator('button[aria-label="删除这张参考图"]').nth(1).click();
        await page.waitForTimeout(400);
        await page.getByPlaceholder('例如：云绯').fill('认真角');
        await page.getByText('下一步：确认特征锁定').click();
        await page.locator('select').first().waitFor({ timeout: 4000 });
        await page.locator('select').nth(2).selectOption('强锁定');
        await page.getByText('保存角色卡').click();
        await page.waitForURL('**/create?character=*', { timeout: 8000 });
      })) pass++;
      total++; if (await step('P2', '详细梗概生成+确认页编辑分镜', async () => {
        await runCreateFlow(page, { synopsis: '深秋的天台上,她把亲手织的围巾塞给他就跑,却忘了里面藏着情书' });
        await page.getByText('第 1 格').first().click();
        await page.locator('input.pf-input').first().waitFor({ timeout: 3000 });
        const sceneInput = page.locator('div:has(> label:text("场景描述")) input').first();
        await sceneInput.fill('天台夕阳,风吹起围巾【大格】');
      })) pass++;
      total++; if (await step('P2', '生成并导出', async () => {
        await confirmAndGenerate(page);
        await page.getByText('导出稿件 →').click();
        await page.waitForURL('**/export?project=*');
        await exportCurrent(page);
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P3自写剧情党',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P3', '建角色', () => createCharacter(page, { name: '自写角' }))) pass++;
      total++; if (await step('P3', '勾选自己写剧情并拆分镜', async () => {
        await page.locator('textarea').fill('她在旧书店发现了一本写着自己名字的日记,日记里记录的是明天的事。她犹豫再三还是翻开了最后一页。');
        await page.getByText('自己写剧情').click();
        await page.getByText('拆分镜 →').click();
        await page.getByText('剧情 + 分镜生成完成').waitFor({ timeout: 20000 });
      })) pass++;
      total++; if (await step('P3', '自写模式显示"你的剧情"而非空起承转合', async () => {
        await page.getByText('你的剧情').waitFor({ timeout: 4000 });
      })) pass++;
      total++; if (await step('P3', '生成', () => confirmAndGenerate(page))) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P4条漫用户(6格+快看长图)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P4', '建角色', () => createCharacter(page, { name: '条漫角' }))) pass++;
      total++; if (await step('P4', '条漫模板+快看平台生成', async () => {
        await runCreateFlow(page, { synopsis: '流浪猫连续七天蹲在便利店门口等她下班', template: '条漫', platform: '快看·条漫长图' });
        await confirmAndGenerate(page);
      })) pass++;
      total++; if (await step('P4', '导出条漫长图(竖排>2:1)', async () => {
        await page.getByText('导出稿件 →').click();
        await page.waitForURL('**/export?project=*');
        await page.getByText('免费导出（含水印）').click();
        await page.getByText('导出成功').waitFor({ timeout: 30000 });
        const ratio = await page.locator('img[alt="导出结果"]').evaluate((img) => img.naturalHeight / img.naturalWidth);
        if (ratio < 2) throw new Error(`条漫导出比例${ratio.toFixed(1)}不是长图`);
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P5九宫格用户(9格+3×3切图)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P5', '建角色', () => createCharacter(page, { name: '九宫角' }))) pass++;
      total++; if (await step('P5', '9格模板生成', async () => {
        await runCreateFlow(page, { synopsis: '早餐店的九种常客,每个人都有自己的固定座位', template: '9格', platform: '小红书·九宫格' });
        await confirmAndGenerate(page);
        const okText = await page.locator('text=/成功 \\d+ \\/ \\d+ 格/').textContent();
        if (!okText.includes('9 / 9')) throw new Error(`9格生成:${okText}`);
      })) pass++;
      total++; if (await step('P5', '导出九宫格(1:1)', async () => {
        await page.getByText('导出稿件 →').click();
        await page.waitForURL('**/export?project=*');
        await exportCurrent(page, 1);
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P6反悔型(反复返回修改)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P6', '建角色后返回工作台再进创作', async () => {
        await createCharacter(page, { name: '反悔角' });
        await page.locator('button[aria-label="返回"]').click();
        await page.waitForURL(BASE + '/', { timeout: 5000 });
        await page.goto(BASE + '/create', { waitUntil: 'networkidle' });
      })) pass++;
      total++; if (await step('P6', '生成→确认页返回→改梗概→重新生成', async () => {
        await runCreateFlow(page, { synopsis: '第一版故事,平平无奇' });
        await page.locator('button[aria-label="返回输入"]').click();
        await page.locator('textarea').waitFor({ timeout: 4000 });
        await page.locator('textarea').fill('第二版故事,更精彩的雨夜相遇');
        await page.getByText('AI 补全剧情 + 分镜').click();
        await page.getByText('剧情 + 分镜生成完成').waitFor({ timeout: 20000 });
      })) pass++;
      total++; if (await step('P6', '确认页点重新生成(带调整方向)', async () => {
        await page.getByPlaceholder('重新生成时的调整方向（可选，如：更悬疑一点）').fill('更浪漫一点');
        await page.getByText('重新生成剧情+分镜').click();
        await page.getByText('剧情 + 分镜生成完成').waitFor({ timeout: 20000 });
        await confirmAndGenerate(page);
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P7气泡玩家(形状/位置/透明度全调)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P7', '建角色+生成', async () => {
        await createCharacter(page, { name: '气泡角' });
        await runCreateFlow(page);
        await confirmAndGenerate(page);
      })) pass++;
      total++; if (await step('P7', '气泡编辑:改文字/形状/位置/透明度', async () => {
        await page.getByText('编辑气泡').click();
        await page.locator('canvas').waitFor({ timeout: 5000 });
        await page.getByPlaceholder('输入对白文字').fill('这里是新对白');
        await page.getByText('爆炸泡', { exact: true }).first().click();
        await page.locator('button[aria-label="位置3"]').first().click();
        await page.locator('input[type="range"]').first().fill('55');
        await page.waitForTimeout(800);
      })) pass++;
      total++; if (await step('P7', '快速切格不串图(竞态防护)', async () => {
        const thumbs = page.locator('button.relative.h-13');
        for (let i = 0; i < 4; i++) await thumbs.nth(i % 2 === 0 ? 1 : 0).click();
        await page.waitForTimeout(1200);
      })) pass++;
      total++; if (await step('P7', '回预览再导出', async () => {
        await page.getByText('← 预览').click();
        await page.getByText('编辑气泡').waitFor({ timeout: 3000 });
        await page.getByText('导出稿件 →').click();
        await page.waitForURL('**/export?project=*');
        await exportCurrent(page);
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P8违禁试探者(拦截→采用建议)',
    mockPlot: false, // 用真实接口测词库拦截(词库层免费秒回)
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P8', '建角色', () => createCharacter(page, { name: '试探角' }))) pass++;
      total++; if (await step('P8', '违禁梗概被拦截显示话术', async () => {
        await page.locator('textarea').fill('画一个偷拍女生裙底的故事');
        await page.getByText('AI 补全剧情 + 分镜').click();
        await page.locator('text=/🚫/').waitFor({ timeout: 15000 });
      })) pass++;
      total++; if (await step('P8', '采用建议自动替换梗概', async () => {
        await page.getByText('采用建议').click();
        const v = await page.locator('textarea').inputValue();
        if (!v || v.includes('偷拍')) throw new Error('梗概未被替换');
      })) pass++;
      total++; if (await step('P8', '连续拦截3次出现风控横幅', async () => {
        for (let i = 0; i < 2; i++) {
          await page.locator('textarea').fill(`如何制作炸弹的教程第${i}版`);
          await page.getByText('AI 补全剧情 + 分镜').click();
          await page.locator('text=/🚫/').waitFor({ timeout: 15000 });
        }
        await page.getByText('多次触发内容安全拦截').waitFor({ timeout: 4000 });
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P9管理型(改锁定/删角色/删作品)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P9', '建角色并完成一个作品', async () => {
        await createCharacter(page, { name: '管理角' });
        await runCreateFlow(page);
        await confirmAndGenerate(page);
      })) pass++;
      total++; if (await step('P9', '角色库调整已有角色锁定', async () => {
        await page.goto(BASE + '/characters', { waitUntil: 'networkidle' });
        await page.getByText('管理角').first().click();
        await page.getByText('特征锁定（可随时调整，下次生成生效）').waitFor({ timeout: 4000 });
        await page.locator('select').first().selectOption('不锁定');
        await page.waitForTimeout(500);
      })) pass++;
      total++; if (await step('P9', '删除被作品引用的角色有警示', async () => {
        await page.locator('button', { hasText: '删除' }).first().click();
        await page.getByText(/个作品在用,确认删?/).waitFor({ timeout: 3000 });
        await page.getByText(/个作品在用,确认删?/).click();
        await page.waitForTimeout(500);
      })) pass++;
      total++; if (await step('P9', '工作台删除作品', async () => {
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        const delBtn = page.locator('button[aria-label^="删除作品"]').first();
        await delBtn.click();
        await delBtn.click();
        await page.waitForTimeout(600);
        const cards = await page.locator('button[aria-label^="删除作品"]').count();
        if (cards !== 0) throw new Error('作品未删除');
      })) pass++;
      return { pass, total };
    },
  },
  {
    name: 'P10回访老用户(续草稿+多平台重复导出)',
    run: async (page) => {
      let pass = 0, total = 0;
      total++; if (await step('P10', '第一次会话完成作品后关闭', async () => {
        await createCharacter(page, { name: '老用户角' });
        await runCreateFlow(page);
        await confirmAndGenerate(page);
      })) pass++;
      total++; if (await step('P10', '重访:工作台点作品卡续作', async () => {
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.locator('a[href*="/storyboard"]').first().click();
        await page.waitForURL('**/storyboard');
        await page.getByText('查看/继续生成 →').click();
        await page.waitForURL('**/generate');
        await page.getByText('稿件预览').waitFor({ timeout: 8000 });
      })) pass++;
      total++; if (await step('P10', '同一作品导出两个平台', async () => {
        await page.getByText('导出稿件 →').click();
        await page.waitForURL('**/export?project=*');
        await exportCurrent(page);
        await page.getByText('小红书·方图').click();
        await page.getByText('免费导出（含水印）').click();
        await page.waitForTimeout(500);
        await page.getByText('导出成功').waitFor({ timeout: 30000 });
      })) pass++;
      total++; if (await step('P10', '导出Tab显示导出记录≥2次', async () => {
        await page.goto(BASE + '/export', { waitUntil: 'networkidle' });
        await page.locator('text=/已导出 \\d+ 次/').waitFor({ timeout: 5000 });
        const txt = await page.locator('text=/已导出 \\d+ 次/').textContent();
        const n = Number(txt.match(/\d+/)[0]);
        if (n < 2) throw new Error(`导出记录${n}次,预期≥2`);
      })) pass++;
      return { pass, total };
    },
  },
];

(async () => {
  const browser = await chromium.launch();
  for (const persona of PERSONAS) {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    await mockRoutes(context, { mockPlot: persona.mockPlot !== false });
    const page = await context.newPage();
    page.on('pageerror', (err) => issues.push({ persona: persona.name.slice(0, 3), step: '(页面异常)', type: 'console', detail: err.message.slice(0, 120) }));
    // 初始化:跳过首次引导(P1除外)
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate((isP1) => {
      localStorage.clear();
      if (!isP1) localStorage.setItem('pf_onboarded_v1', '1');
    }, persona.name.startsWith('P1'));

    const t0 = Date.now();
    let r = { pass: 0, total: 0 };
    try {
      r = await persona.run(page);
    } catch (err) {
      issues.push({ persona: persona.name.slice(0, 3), step: '(整体中断)', type: 'fail', detail: err.message.slice(0, 120) });
    }
    summary.push({ persona: persona.name, pass: r.pass, total: r.total, sec: ((Date.now() - t0) / 1000).toFixed(0) });
    console.log(`${r.pass === r.total ? '✅' : '⚠️'} ${persona.name} — ${r.pass}/${r.total} (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
    await context.close();
  }
  await browser.close();

  console.log('\n════ 卡点与问题清单 ════');
  if (issues.length === 0) console.log('(无卡点)');
  issues.forEach((i) => console.log(`[${i.type}] ${i.persona} · ${i.step} — ${i.detail}`));
  const totalPass = summary.reduce((s, x) => s + x.pass, 0);
  const totalSteps = summary.reduce((s, x) => s + x.total, 0);
  console.log(`\n════ 总计: ${totalPass}/${totalSteps} 步通过, ${issues.length} 个卡点 ════`);
})();
