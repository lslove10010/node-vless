require('dotenv').config();
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');
const { exec } = require('child_process');
const { Buffer } = require('buffer');
const { createServer } = require('http');
const { WebSocketServer, createWebSocketStream } = require('ws');
const https = require('https');

// ==================== 配置区 ====================
const UUID = process.env.UUID || '7322ae40-61ce-4990-8251-c00a8b87da6e';
const DOMAIN = process.env.DOMAIN || 'icmp9.cnav.cn.eu.org';
const PORT = process.env.PORT || 8080;
const REMARKS = process.env.REMARKS || 'nodejs-vless';
const SUB_PATH = process.env.SUB_PATH || 'websub'; // 自定义订阅路径
const WEB_SHELL = process.env.WEB_SHELL || 'off'; // on 开 web shell（仅调试用！）
// ================================================

// 获取公网 IP 的函数（异步 + 多接口 fallback）
async function getPublicIP() {
    const apis = [
        { url: 'https://api.ipify.org', parse: r => r },
        { url: 'https://api.ipify.org?format=json', parse: r => JSON.parse(r).ip },
        { url: 'https://ifconfig.me/ip', parse: r => r.trim() },
        { url: 'https://free.freeipapi.com', parse: r => r.trim() },
        { url: 'https://api.ipapi.co/json', parse: r => JSON.parse(r).ip },
    ];
    for (const api of apis) {
        try {
            return await new Promise((resolve, reject) => {
                https.get(api.url, { timeout: 5000 }, (res) => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Status ${res.statusCode}`));
                        return;
                    }
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const ip = api.parse(data);
                            if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.includes(':')) {
                                resolve(ip);
                            } else {
                                reject(new Error('Invalid IP format'));
                            }
                        } catch {
                            reject(new Error('Parse failed'));
                        }
                    });
                }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
            });
        } catch (err) {
            // console.debug(`API ${api.url} failed: ${err.message}`);
        }
    }
    return null;
}

function generateTempFilePath() {
    const randomStr = crypto.randomBytes(4).toString('hex');
    return path.join(__dirname, `wsr-${randomStr}.sh`);
}

function executeScript(script, callback) {
    const scriptPath = generateTempFilePath();
    fs.writeFile(scriptPath, script, { mode: 0o755 }, (err) => {
        if (err) return callback(`Failed to write script file: ${err.message}`);
        exec(`sh "${scriptPath}"`, { timeout: 10000 }, (error, stdout, stderr) => {
            fs.unlink(scriptPath, () => {});
            if (error) return callback(stderr || error.message);
            callback(null, stdout);
        });
    });
}

// ==================== HTTP 服务器 & 页面 ====================
const server = createServer((req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const requestPath = parsedUrl.pathname;

    // 1. 根路径 / —— 欢迎页
    if (requestPath === '/') {
        const welcomeHTML = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>张三的个人空间</title>
  <meta name="description" content="分享一些日常想法、生活记录和技术随笔"/>
  <style>
    :root {
      --bg: #0f1217;
      --text: #e0e7ff;
      --text-light: #a1a9c2;
      --accent: #6366f1;
      --card: #1a1f2e;
      --border: #2d3748;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    .container {
      max-width: 860px;
      margin: 0 auto;
      padding: 3rem 1.5rem;
    }

    header {
      text-align: center;
      padding: 5rem 0 4rem;
    }

    h1 {
      font-size: 3.2rem;
      font-weight: 700;
      margin-bottom: 0.8rem;
      background: linear-gradient(90deg, #a5b4fc, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .tagline {
      font-size: 1.3rem;
      color: var(--text-light);
      margin-bottom: 1.5rem;
    }

    .about {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2.5rem;
      margin-bottom: 3rem;
    }

    .about h2 {
      color: white;
      margin-bottom: 1.2rem;
      font-size: 1.8rem;
    }

    .projects {
      display: grid;
      gap: 2rem;
      margin-bottom: 4rem;
    }

    .project-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.8rem;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .project-card:hover {
      transform: translateY(-6px);
      box-shadow: 0 12px 32px rgba(0,0,0,0.3);
    }

    .project-card h3 {
      color: var(--accent);
      margin-bottom: 0.6rem;
    }

    .project-card p {
      color: var(--text-light);
      margin-bottom: 1rem;
    }

    .links {
      text-align: center;
    }

    .btn {
      display: inline-block;
      padding: 0.8rem 1.8rem;
      background: var(--accent);
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
      transition: background 0.2s;
    }

    .btn:hover {
      background: #4f46e5;
    }

    footer {
      text-align: center;
      padding: 3rem 0;
      color: var(--text-light);
      font-size: 0.9rem;
      border-top: 1px solid var(--border);
    }

    @media (max-width: 640px) {
      h1 { font-size: 2.4rem; }
      .container { padding: 2rem 1rem; }
    }
  </style>
</head>
<body>

  <div class="container">
    <header>
      <h1>张三</h1>
      <div class="tagline">普通打工人 · 喜欢折腾 · 偶尔写点东西</div>
    </header>

    <section class="about">
      <h2>关于我</h2>
      <p>
        目前在北京混日子，平时喜欢研究一些乱七八糟的小玩意儿。<br>
        主要方向是前端开发、偶尔摸摸后端和运维，喜欢把复杂的东西搞简单。
      </p>
      <p>
        这里放一些随手写的笔记、踩过的坑、看过的书/电影感想，欢迎路过指正。
      </p>
    </section>

    <section class="projects">
      <h2 style="text-align:center; margin-bottom:2rem; color:white;">最近瞎折腾的几个东西</h2>
      
      <div class="project-card">
        <h3>日常随笔收集器</h3>
        <p>一个用来记录生活碎片的极简工具，自己用着还挺顺手。</p>
      </div>

      <div class="project-card">
        <h3>深夜歌单整理</h3>
        <p>把过去一年听的最多的歌整理了一下，意外发现自己口味还挺奇怪。</p>
      </div>

      <div class="project-card">
        <h3>桌面小组件实验</h3>
        <p>用 electron 搞了个桌面小挂件，显示天气+待办+摸鱼倒计时。</p>
      </div>
    </section>

    <div class="links">
      <a href="#" class="btn">查看更多碎碎念 →</a>
    </div>

    <footer>
      © 2026 张三 · 随便写写 · 别太认真
    </footer>
  </div>

</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(welcomeHTML);
    }

    // 2. 订阅路径
    if (requestPath === `/${SUB_PATH}`) {
        const vless = `vless://${UUID}@www.visakorea.com:443?encryption=none&security=tls&sni=${DOMAIN}&fp=chrome&type=ws&host=${DOMAIN}&path=%2F#${encodeURIComponent(REMARKS)}`;
        const base64 = Buffer.from(vless, 'utf-8').toString('base64');
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'Access-Control-Allow-Origin': '*'
        });
        return res.end(base64);
    }

    // 3. Web Shell（调试用）
    if (requestPath === `/${SUB_PATH}/run` && WEB_SHELL === 'on') {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            return res.end('Method Not Allowed');
        }
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > 1e6) req.socket.destroy();
        });
        req.on('end', () => {
            executeScript(body, (err, output) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    return res.end(err);
                }
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(output || 'Executed.');
            });
        });
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// ==================== VLESS over WebSocket ====================
function parseHandshake(buf) {
    let offset = 0;
    const version = buf.readUInt8(offset); offset += 1;
    const id = buf.subarray(offset, offset + 16); offset += 16;
    const optLen = buf.readUInt8(offset); offset += 1 + optLen;
    const command = buf.readUInt8(offset); offset += 1;
    const port = buf.readUInt16BE(offset); offset += 2;
    const addressType = buf.readUInt8(offset); offset += 1;
    let host = '';
    if (addressType === 1) {
        host = Array.from(buf.subarray(offset, offset + 4)).join('.');
        offset += 4;
    } else if (addressType === 2) {
        const len = buf.readUInt8(offset++);
        host = buf.subarray(offset, offset + len).toString();
        offset += len;
    } else if (addressType === 3) {
        const segments = [];
        for (let i = 0; i < 8; i++) {
            segments.push(buf.readUInt16BE(offset).toString(16));
            offset += 2;
        }
        host = segments.join(':');
    } else {
        throw new Error(`Unsupported address type: ${addressType}`);
    }
    return { version, id, command, host, port, offset };
}

const uuidBuffer = Buffer.from(UUID.replace(/-/g, ''), 'hex');
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
    ws.once('message', msg => {
        try {
            const { version, id, host, port, offset } = parseHandshake(msg);
            if (!id.equals(uuidBuffer)) {
                return ws.close();
            }
            ws.send(Buffer.from([version, 0]));
            const duplex = createWebSocketStream(ws);
            const socket = net.connect({ host, port }, () => {
                socket.write(msg.slice(offset));
                duplex.pipe(socket).pipe(duplex);
            });
            duplex.on('error', () => {});
            socket.on('error', () => {});
            socket.on('close', () => ws.terminate());
            duplex.on('close', () => socket.destroy());
        } catch (err) {
            ws.close();
        }
    });
});

// ==================== 同时监听 IPv4 和 IPv6 ====================
(async () => {
    const publicIP = await getPublicIP();

    // 方式1：监听 :: （绝大多数现代系统会同时接受 IPv4 和 IPv6 连接）
    server.listen(PORT, '::', () => {
        console.log(`Server is listening on [::]:${PORT} (IPv4 + IPv6)`);
        
        if (publicIP) {
            console.log(`- 管理页面 → http://${publicIP}:${PORT}/   (或 https://${DOMAIN}:443/)`);
            console.log(`- 订阅地址 → http://${publicIP}:${PORT}/${SUB_PATH}`);
        } else {
            console.log(`- 管理页面 → https://${DOMAIN}:443/`);
            console.log(`- 订阅地址 → https://${DOMAIN}:443/${SUB_PATH}`);
            console.log(' (公网 IP 自动检测失败，使用域名代替)');
        }
        
        console.log(`- WebShell → ${WEB_SHELL === 'on' ? '已开启' : '已关闭'}`);
        console.log('');
    });

    // 方式2：如果上面方式在你的系统不生效，可额外显式监听 IPv4（一般不需要）
    // server.listen(PORT, '0.0.0.0', () => {
    //     console.log(`额外监听 IPv4: 0.0.0.0:${PORT}`);
    // });
})();
