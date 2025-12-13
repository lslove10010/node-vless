# 使用 Node 20 slim 版
FROM node:20-alpine3.20

# 设置工作目录
WORKDIR /app

COPY index.js package.json ./

# 安装生产依赖（更可靠）
RUN apk update && apk add --no-cache bash openssl curl &&\
    chmod +x index.js &&\
    npm install


# 切换到非 root 用户（必须）
USER 10014

# 暴露端口（建议声明，Choreo 会用 PORT 环境变量，通常 8080）
EXPOSE 8080

# 启动命令（确保 package.json 有 "start": "node index.js"）
CMD ["node", "index.js"]
