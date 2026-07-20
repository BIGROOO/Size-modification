# 图片尺寸与文案检查

一个完全在浏览器本地运行的图片处理工具，可批量统一图片尺寸、使用 OCR 检查重复文案，并在 Chrome / Edge 授权后覆盖原文件。

## 在线使用

- GitHub Pages：<https://bigrooo.github.io/Size-modification/>
- Sites 备用站点：<https://tuzhun-image-checker.zidanebibby.chatgpt.site>

## 主要功能

- 将 JPG、PNG、WebP 调整为 800×800、1000×1000 或自定义尺寸。
- 完整保留原图比例，通过背景色补齐画布，不裁切、不变形。
- 使用简体中文和英文 OCR 检查相同及高度相似文案。
- Chrome / Edge 桌面版可在用户授权后保留文件名并覆盖原文件。
- 不兼容文件夹写入的浏览器自动使用普通下载模式。

图片、OCR 文本和处理结果不会上传到服务器。首次加载 OCR 语言模型需要联网。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

## 构建与测试

```bash
npm run build
npm run build:pages
npm test
npm run lint
```

`npm run build` 生成 Sites 部署产物；`npm run build:pages` 生成 GitHub Pages 静态产物。推送到 `main` 后，GitHub Actions 会自动更新 Pages 站点。
