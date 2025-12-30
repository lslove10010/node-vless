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
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Node.js · ${REMARKS}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500&family=Inter:wght@500;600&display=swap');
        body,html{height:100%;margin:0;background:linear-gradient(135deg,#0f172a,#1e293b);color:#e2e8f0;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;}
        .card{max-width:540px;width:90%;background:#1e293b;border-radius:20px;box-shadow:0 30px 60px rgba(0,0,0,0.6);overflow:hidden;border:1px solid #334155;}
        header{background:linear-gradient(120deg,#7c3aed,#db2777);padding:3rem 2rem;text-align:center;color:white;}
        h1{font-size:2.8rem;margin:0;font-weight:600;}
        p{margin:0.6rem 0 0;opacity:0.9;font-size:1.1rem;}
        .body{padding:2.5rem;text-align:center;}
        .path{display:block;background:#0f172a;padding:16px 28px;border-radius:12px;font-family:'JetBrains Mono',monospace;margin:2rem 0;font-size:1.1rem;border:1px solid #475569;word-break:break-all;}
        .btn{display:inline-block;margin:0.8rem;padding:14px 32px;background:#7c3aed;color:white;border-radius:12px;text-decoration:none;font-weight:600;transition:.3s;box-shadow:0 8px 20px rgba(124,58,237,0.3);}
        .btn:hover{transform:translateY(-4px);box-shadow:0 15px 30px rgba(124,58,237,0.5);}
        footer{margin-top:3rem;color:#94a3b8;font-size:0.95rem;}
        a{color:#a78bfa;text-decoration:none;}
        .warn{color:#fb7185;margin-top:1.5rem;font-size:0.9rem;}
    </style>
</head>
<body>
    <div class="card">
        <header>
            <h1>Node.js server</h1>
            <p>纯 Node.js 实现 · 支持 IPv4 / IPv6</p>
        </header>
        <div class="body">
            <p>订阅地址（复制下方链接到客户端一键导入）</p>
            <div class="path">https://${DOMAIN}:443/${SUB_PATH}</div>
            <a href="https://${DOMAIN}:443/${SUB_PATH}" class="btn">查看订阅内容（Base64）</a>
            ${WEB_SHELL === 'on' ? `<p class="warn">Web Shell 已开启（仅用于调试，请勿在生产环境开启）</p>` : ''}
        </div>
        <footer>Powered with ♥ by nodejs-website</footer>
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
