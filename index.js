const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');
const { exec } = require('child_process');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');

// ==================== 手动加载 .env 文件（替代 dotenv）====================
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const data = fs.readFileSync(envPath, 'utf8');
    data.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#') && line.includes('=')) {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key.trim()]) { // 命令行优先，不覆盖
          process.env[key.trim()] = value;
        }
      }
    });
    console.log('✅ 从 .env 文件加载环境变量成功（命令行变量优先）');
  } else {
    console.log('⚠️ 未找到 .env 文件，使用命令行环境变量或默认值');
  }
}
loadEnv(); // 立即执行

// ==================== 配置 ====================
const config = {
  UUID: process.env.UUID || '',
  DOMAIN: process.env.DOMAIN || '',
  PORT: Number(process.env.PORT) || 3000,
  REMARKS: process.env.REMARKS || '',
  SUB_PATH: (process.env.SUB_PATH || 'websub').replace(/^\/+/, '').replace(/\/+$/, ''),
  WEB_SHELL: String(process.env.WEB_SHELL || 'off').toLowerCase() === 'on',
  // 计算 WebSocket 路径 = / + UUID 前8位（去连字符）
  get wsPath() {
    const cleanUuid = this.UUID.replace(/-/g, '');
    return '/' + cleanUuid.slice(0, 8);
  },
};

// ==================== 工具函数 ====================
async function getPublicIP() {
  const apis = [
    'https://api.ipify.org',
    'https://api.ipify.org?format=json',
    'https://ifconfig.me/ip',
    'https://api.ipapi.co/json',
  ];
  for (const url of apis) {
    try {
      return await new Promise((resolve, reject) => {
        const req = require('https').get(url, { timeout: 5000 }, (res) => {
          if (res.statusCode !== 200) return reject();
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const ip =
                url.includes('json') ? JSON.parse(data).ip : data.trim();
              if (/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.|$)){4}$/.test(ip)) {
                resolve(ip);
              } else {
                reject();
              }
            } catch {
              reject();
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject();
        });
      });
    } catch {
      // silent fail
    }
  }
  return null;
}
function generateTempFilePath() {
  return path.join(__dirname, `tmp-${crypto.randomBytes(6).toString('hex')}.sh`);
}
function executeScript(scriptContent, callback) {
  const filePath = generateTempFilePath();
  fs.writeFile(filePath, scriptContent, { mode: 0o755 }, (err) => {
    if (err) return callback(`write file failed: ${err.message}`);
    exec(`sh "${filePath}"`, { timeout: 10000 }, (error, stdout, stderr) => {
      fs.unlink(filePath, () => {});
      if (error) return callback(stderr || error.message);
      callback(null, stdout.trim() || 'Executed.');
    });
  });
}

// ==================== 伪装博客内容数据（用于随机化和多页） ====================
const fakeArticles = [
  {
    id: '1',
    date: '2026/01/03',
    title: '今年最值得折腾的 3 个小工具（上）',
    excerpt: '从命令行 RSS 阅读器到本地 AI 笔记助手，再到自建图床，最近把玩了几个挺有意思的东西，分享一下使用心得。',
    fullContent: '<p>详细内容：从命令行 RSS 阅读器到本地 AI 笔记助手，再到自建图床，最近把玩了几个挺有意思的东西，分享一下使用心得。包括安装步骤、优缺点分析等。</p><p>工具1: RSS 阅读器 - 简单高效。</p><p>工具2: AI 笔记 - 智能整理。</p>',
    category: '技术',
    readTime: '8 min read',
    likes: 12
  },
  {
    id: '2',
    date: '2025/12/29',
    title: '为什么我把博客搬回了纯静态',
    excerpt: '折腾了各种 CMS 和 SSG 之后，还是觉得简单直接最舒服。部署成本、速度、隐私三方面都赢麻了。',
    fullContent: '<p>详细内容：折腾了各种 CMS 和 SSG 之后，还是觉得简单直接最舒服。部署成本、速度、隐私三方面都赢麻了。包括迁移过程、工具推荐等。</p><p>优势1: 速度快。</p><p>优势2: 成本低。</p>',
    category: '技术',
    readTime: '6 min read',
    likes: 19
  },
  {
    id: '3',
    date: '2025/12/24',
    title: '深夜emo歌单 vol.08 · 冬夜限定',
    excerpt: '今年冬天最常循环的几首，氛围感拉满，听着听着就想发呆。',
    fullContent: '<p>详细内容：今年冬天最常循环的几首，氛围感拉满，听着听着就想发呆。包括歌单列表、推荐理由等。</p><p>歌曲1: Song A - 理由。</p><p>歌曲2: Song B - 理由。</p>',
    category: '生活',
    readTime: '3 min read',
    likes: 25
  },
  {
    id: '4',
    date: '2025/12/18',
    title: '2025 年度摸鱼报告（自欺欺人版）',
    excerpt: '看了下 git 提交记录和摸鱼时长统计……嗯，生产力确实有一点微小的提升（自我安慰）。',
    fullContent: '<p>详细内容：看了下 git 提交记录和摸鱼时长统计……嗯，生产力确实有一点微小的提升（自我安慰）。包括数据分析、反思等。</p><p>部分1: 提交记录。</p><p>部分2: 摸鱼时长。</p>',
    category: '生活',
    readTime: '5 min read',
    likes: 31
  },
  {
    id: '5',
    date: '2025/12/10',
    title: '用 Bun 重新折腾了一次个人面板',
    excerpt: 'Bun 真的香，启动速度快到离谱，配合 Elysia 写 API 体验极好，这次彻底抛弃了 Node。',
    fullContent: '<p>详细内容：Bun 真的香，启动速度快到离谱，配合 Elysia 写 API 体验极好，这次彻底抛弃了 Node。包括代码示例、比较等。</p><p>步骤1: 安装 Bun。</p><p>步骤2: 构建 API。</p>',
    category: '技术',
    readTime: '7 min read',
    likes: 14
  },
  {
    id: '6',
    date: '2025/11/28',
    title: '最近在用什么桌面软件',
    excerpt: 'Raycast + Arc + Obsidian + iTerm + CleanShot X，2025年末生产力工具配置分享。',
    fullContent: '<p>详细内容：Raycast + Arc + Obsidian + iTerm + CleanShot X，2025年末生产力工具配置分享。包括每个工具的用法。</p><p>工具1: Raycast - 快捷启动。</p><p>工具2: Arc - 浏览器。</p>',
    category: '生活',
    readTime: '4 min read',
    likes: 22
  },
  {
    id: '7',
    date: '2025/11/15',
    title: '为什么我不再追新手机了',
    excerpt: '用了三年旧旗舰，发现新机除了拍照和跑分，其他体验几乎没有质的飞跃。',
    fullContent: '<p>详细内容：用了三年旧旗舰，发现新机除了拍照和跑分，其他体验几乎没有质的飞跃。包括个人经历、建议等。</p><p>原因1: 性能过剩。</p><p>原因2: 价格高。</p>',
    category: '生活',
    readTime: '5 min read',
    likes: 18
  },
  {
    id: '8',
    date: '2025/10/30',
    title: '自建 homelab 小记：NAS + 软路由 + 家庭服务器',
    excerpt: '用旧电脑+绿联DX4600+旁路由，成本不到3000块的家庭服务器方案。',
    fullContent: '<p>详细内容：用旧电脑+绿联DX4600+旁路由，成本不到3000块的家庭服务器方案。包括硬件列表、配置指南等。</p><p>硬件1: 旧电脑。</p><p>硬件2: DX4600。</p>',
    category: '技术',
    readTime: '9 min read',
    likes: 27
  }
];

// 随机打乱数组的函数
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 生成首页 HTML（随机打乱文章顺序）
function getFakeHomepageHTML() {
  const shuffledArticles = shuffleArray(fakeArticles);
  let articlesHTML = '';
  shuffledArticles.forEach(article => {
    articlesHTML += `
      <article class="card">
        <div class="card-date">${article.date}</div>
        <h2 class="card-title"><a href="/post/${article.id}">${article.title}</a></h2>
        <p class="card-excerpt">${article.excerpt}</p>
        <div class="card-meta">
          <span>${article.category} · ${article.readTime}</span>
          <span>${article.likes} 赞</span>
        </div>
      </article>
    `;
  });
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>BB日志 - 深夜随手记</title>
  <meta name="description" content="深夜emo、技术碎碎念、生活小事、偶尔折腾点代码"/>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
 
  <style>
    :root {
      --bg: #0d0f17;
      --bg-card: rgba(30, 35, 55, 0.45);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #7c3aed;
      --accent-glow: #a78bfa;
      --border: rgba(148, 163, 184, 0.18);
      --radius: 16px;
    }
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      background-image:
        radial-gradient(circle at 20% 30%, rgba(124,58,237,0.08) 0%, transparent 25%),
        radial-gradient(circle at 80% 70%, rgba(167,139,250,0.06) 0%, transparent 30%);
      min-height: 100vh;
      line-height: 1.6;
    }
    .container { max-width:960px; margin:0 auto; padding:4rem 1.5rem 6rem; }
    header { text-align:center; padding:5rem 0 4rem; }
    h1 {
      font-size: clamp(2.8rem,8vw,4.2rem);
      font-weight:700;
      background: linear-gradient(90deg, #c084fc, #7c3aed, #a78bfa);
      -webkit-background-clip:text;
      -webkit-text-fill-color:transparent;
      letter-spacing:-0.02em;
      margin-bottom:0.8rem;
    }
    .subtitle { font-size:1.25rem; color:var(--text-muted); margin-bottom:1rem; font-weight:400; }
   
    nav { text-align:center; margin:2rem 0 3rem; }
    nav a {
      color:var(--text-muted);
      margin:0 1.2rem;
      text-decoration:none;
      font-weight:500;
      transition:color 0.3s;
    }
    nav a:hover { color:var(--accent-glow); }
   
    .articles {
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(340px,1fr));
      gap:2rem;
      margin:3rem 0;
    }
    .card {
      background:var(--bg-card);
      backdrop-filter:blur(12px);
      border:1px solid var(--border);
      border-radius:var(--radius);
      padding:1.8rem 2rem;
      transition:all 0.35s cubic-bezier(0.16,1,0.3,1);
      position:relative;
      overflow:hidden;
    }
    .card:hover {
      transform:translateY(-8px);
      box-shadow:0 24px 48px rgba(0,0,0,0.35);
      border-color:rgba(167,139,250,0.35);
    }
    .card::before {
      content:'';
      position:absolute;
      inset:0;
      background:linear-gradient(135deg,transparent 0%,rgba(167,139,250,0.05)100%);
      opacity:0;
      transition:opacity 0.6s ease;
    }
    .card:hover::before { opacity:1; }
    .card-date {
      font-size:0.875rem;
      color:var(--text-muted);
      margin-bottom:0.75rem;
      font-family:'JetBrains Mono',monospace;
    }
    .card-title { font-size:1.42rem; font-weight:600; margin-bottom:0.9rem; color:white; line-height:1.3; }
    .card-title a { color:white; text-decoration:none; }
    .card-excerpt { color:var(--text-muted); font-size:0.98rem; margin-bottom:1rem; }
    .card-meta {
      font-size:0.85rem;
      color:var(--text-muted);
      margin-top:1rem;
      display:flex;
      gap:1.5rem;
    }
    footer {
      text-align:center;
      padding:4rem 0 2rem;
      color:var(--text-muted);
      font-size:0.875rem;
      border-top:1px solid var(--border);
    }
    @media (max-width:640px) {
      .container { padding:3rem 1rem 5rem; }
      header { padding:4rem 0 3rem; }
      h1 { font-size:2.8rem; }
      nav a { margin:0 0.8rem; font-size:0.95rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>BB日志</h1>
      <div class="subtitle">深夜emo · 技术碎碎念 · 生活小事 · 偶尔折腾点代码</div>
    </header>
    <nav>
      <a href="/">首页</a>
      <a href="/category/tech">技术</a>
      <a href="/category/life">生活</a>
      <a href="/about">关于</a>
      <a href="/archive">归档</a>
      <a href="/feed">RSS</a>
    </nav>
    <main class="articles">
      ${articlesHTML}
    </main>
    <footer>
      © 2025–2026 BB · 随便写写 · 别太当真<br>
      <small>Powered by 深夜emo & 咖啡因</small>
    </footer>
  </div>
</body>
</html>`;
}

// 生成假文章详情页 HTML
function getFakePostHTML(id) {
  const article = fakeArticles.find(a => a.id === id);
  if (!article) {
    return '<h1>404 - 文章未找到</h1>';
  }
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${article.title} - BB日志</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d0f17;
      --bg-card: rgba(30, 35, 55, 0.45);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #7c3aed;
      --border: rgba(148, 163, 184, 0.18);
      --radius: 16px;
    }
    body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; padding: 4rem 1.5rem; }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; color: white; }
    .post-meta { color: var(--text-muted); margin-bottom: 2rem; font-size: 0.95rem; }
    .post-content { background: var(--bg-card); padding: 2rem; border-radius: var(--radius); border: 1px solid var(--border); }
    .post-content p { margin-bottom: 1.5rem; }
    footer { text-align: center; margin-top: 4rem; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="container">
    <h1>${article.title}</h1>
    <div class="post-meta">
      发表于 ${article.date} · ${article.category} · ${article.readTime} · ${article.likes} 赞
    </div>
    <div class="post-content">
      ${article.fullContent}
      <p>欢迎评论或分享你的想法！</p>
    </div>
    <footer>
      <a href="/">返回首页</a> · © 2025–2026 BB
    </footer>
  </div>
</body>
</html>`;
}

// 生成假 RSS feed XML
function getFakeRSS() {
  let itemsXML = '';
  fakeArticles.forEach(article => {
    itemsXML += `
      <item>
        <title>${article.title}</title>
        <link>https://${config.DOMAIN}/post/${article.id}</link>
        <description>${article.excerpt}</description>
        <pubDate>${new Date(article.date.replace(/\//g, '-')).toUTCString()}</pubDate>
        <guid>https://${config.DOMAIN}/post/${article.id}</guid>
      </item>
    `;
  });
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>BB日志</title>
    <link>https://${config.DOMAIN}</link>
    <description>深夜emo、技术碎碎念、生活小事</description>
    ${itemsXML}
  </channel>
</rss>`;
}

// ==================== HTTP + WebSocket 服务器 ====================
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  // 根路径 - 伪装首页（随机化文章）
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getFakeHomepageHTML());
    return;
  }
  // 假文章详情页
  if (pathname.startsWith('/post/')) {
    const id = pathname.split('/post/')[1].split('/')[0];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getFakePostHTML(id));
    return;
  }
  // 假 RSS feed
  if (pathname === '/feed' || pathname === '/rss.xml') {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(getFakeRSS());
    return;
  }
  // 其他假路由（category, about, archive） - 返回首页或404
  if (pathname.startsWith('/category/') || pathname === '/about' || pathname === '/archive') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getFakeHomepageHTML()); // 简单重用首页
    return;
  }
  // 订阅地址
  if (pathname === `/${config.SUB_PATH}`) {
    const vless = `vless://${config.UUID}@www.visakorea.com:443?` +
                 `encryption=none&security=tls&sni=${config.DOMAIN}&fp=chrome&` +
                 `type=ws&host=${config.DOMAIN}&path=${encodeURIComponent(config.wsPath)}` +
                 `#${encodeURIComponent(config.REMARKS)}`;
    const encoded = Buffer.from(vless).toString('base64');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(encoded);
    return;
  }
  // 简易调试用 webshell（危险！仅本地/测试环境开启）
  if (config.WEB_SHELL && pathname === `/${config.SUB_PATH}/run` && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.socket.destroy();
    });
    req.on('end', () => {
      executeScript(body, (err, output) => {
        res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(err || output);
      });
    });
    return;
  }
  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// ==================== VLESS over WS 核心逻辑 ====================
const uuidBuffer = Buffer.from(config.UUID.replace(/-/g, ''), 'hex');
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.once('message', (data) => {
    try {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const { version, id, host, port, offset } = parseVlessHandshake(buf);
      if (!id.equals(uuidBuffer)) {
        ws.close(1008, 'Invalid UUID');
        return;
      }
      ws.send(Buffer.from([version, 0]));
      const duplex = require('ws').createWebSocketStream(ws, {
        allowHalfOpen: true,
      });
      const socket = net.connect({ host, port }, () => {
        socket.write(buf.slice(offset));
        duplex.pipe(socket).pipe(duplex);
      });
      const cleanup = () => {
        socket.destroy();
        ws.terminate();
      };
      socket.on('error', cleanup);
      duplex.on('error', cleanup);
      socket.on('close', () => ws.terminate());
      duplex.on('close', () => socket.destroy());
    } catch {
      ws.close(1002, 'Protocol error');
    }
  });
});

// VLESS 握手解析（支持 IPv4、域名、IPv6）
function parseVlessHandshake(buf) {
  let offset = 0;
  const version = buf.readUInt8(offset++);
  const id = buf.subarray(offset, offset + 16); offset += 16;
  const addonsLen = buf.readUInt8(offset++); offset += addonsLen;
  const command = buf.readUInt8(offset++);
  const port = buf.readUInt16BE(offset); offset += 2;
  const addrType = buf.readUInt8(offset++);
  let host;
  switch (addrType) {
    case 1: // IPv4
      host = Array.from(buf.subarray(offset, offset + 4)).join('.');
      offset += 4;
      break;
    case 2: // 域名
      const len = buf.readUInt8(offset++);
      host = buf.subarray(offset, offset + len).toString();
      offset += len;
      break;
    case 3: // IPv6
      const ipv6Bytes = buf.subarray(offset, offset + 16);
      host = Array.from(ipv6Bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .reduce((acc, cur, idx) => acc + (idx % 2 === 1 ? ':' + cur : cur), '')
        .replace(/(^|:)0+(:|$)/g, '$1$2');
      if (host.startsWith(':')) host = '0' + host;
      if (host.endsWith(':')) host += '0';
      offset += 16;
      break;
    default:
      throw new Error('Unsupported address type');
  }
  return { version, id, host, port, offset };
}

// ==================== 启动 ====================
(async () => {
  const ip = await getPublicIP().catch(() => null);
  server.listen(config.PORT, '::', () => {
    console.log(`Server listening on port ${config.PORT} (IPv4+IPv6)`);
    console.log(`页面: ${ip ? `http://${ip}:${config.PORT}` : `https://${config.DOMAIN}`}`);
    console.log(`dy地址: ${ip ? `http://${ip}:${config.PORT}/${config.SUB_PATH}` : `https://${config.DOMAIN}/${config.SUB_PATH}`}`);
    console.log(`WebSocket路径: ${config.wsPath}`);
    if (config.WEB_SHELL) {
      console.log('警告：WebShell 已开启（非常危险！）');
    }
  });
})();
