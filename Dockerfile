# 使用 Node 20 slim 版
FROM node:20-slim

# 设置工作目录
WORKDIR /app

# 先复制 package.json（利用缓存）
COPY package*.json ./

# 安装生产依赖（更可靠）
RUN npm ci --only=production --silent

# 复制所有代码（包括 index.js）
COPY . .

# Choreo 强制：创建 UID 在 10000-20000 范围的非 root 用户
RUN addgroup --gid 10014 choreogroup && \
    adduser --uid 10014 --gid 10014 --disabled-password --gecos "" choreouser

# 切换到非 root 用户（必须）
USER 10014

# 暴露端口（建议声明，Choreo 会用 PORT 环境变量，通常 8080）
EXPOSE 8080

# 启动命令（确保 package.json 有 "start": "node index.js"）
CMD ["npm", "start"]
