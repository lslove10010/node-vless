# 使用官方 Node.js 瘦身版作为基础镜像（推荐使用 slim 版本，镜像更小）
FROM node:20-slim AS base

# 设置工作目录
WORKDIR /app

# 先复制 package.json 和 package-lock.json（如果有），利用 Docker 层缓存加速后续构建
COPY package*.json ./

# 安装生产环境依赖（--production 跳过 devDependencies）
RUN npm ci --production --silent

# 复制项目所有剩余文件（包括 index.js、.env 如果你坚持要用文件方式等）
# 注意：推荐不要提交 .env 到 Git，而是用 Choreo 的 Configs & Secrets 注入环境变量
COPY . .

# ------------------- Choreo 安全要求 -------------------
# Choreo 强制要求容器以非 root 用户运行，且 UID 必须在 10000-20000 范围内
# 我们创建一个符合要求的专用用户
RUN addgroup --gid 10001 choreo-group && \
    adduser --uid 10001 --gid 10001 --disabled-password --gecos "" choreo-user

# 切换到非 root 用户（必须，否则 Choreo 构建会失败）
USER 10001

# 暴露端口（可选，Choreo 会自动检测，但建议声明）
EXPOSE 8080

# 启动命令
# 确保你的 package.json 中有 "start": "node index.js"
CMD ["npm", "start"]
