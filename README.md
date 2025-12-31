# SpectraFilm: 物理级胶片模拟引擎

**SpectraFilm** 是一个基于物理原理的胶片模拟引擎，完全在浏览器端运行，仅支持 RAW 格式。通过精确模拟胶片的光化学反应过程，实现高保真的胶片效果。

## 须知

本项目为作者本人使用Antigravity从0搭建，为了前端网页部署，从而使用TypeScript语言。

作者只测试了索尼的.arw格式，其他格式未测试，理论上应该相同。

项目仅为demo，未经过充分测试，欢迎提交issue。

各个选项可以多加尝试，不能保证效果。个人认为出图效果一般，不如 https://github.com/Linglingletsgo/Phos_refactor，但项目使用了胶片的具体参数曲线参与计算，更符合物理模拟的特性，但存在一些色偏、曝光异常、信息丢失之类的各种问题，算法复杂本人短时间难以排查问题所在，需要后续优化。

计算时间较长，请耐心等待。

无镜头畸变校正信息，所以生成图片会存在畸变。

仅供学习使用，禁止商用。

项目已部署在 https://www.dominicduan.com/spectrafilm，欢迎访问测试。
本项目链接仅为架构发布与项目简介，后续一切更新请访问 https://www.dominicduan.com/spectrafilm。

## 联系方式
@Dominic Duan

GitHub: https://github.com/Linglingletsgo/

Website: www.dominicduan.com

Email: lingonthebeat@gmail.com

小红书 (XiaoHongShu): @Linglingletsgo


## ✨ 核心特性

### 🎯 物理仿真引擎
基于真实胶片物理学的 4 阶段光学管线：

1. **曝光 (Exposure)** - 光谱响应模拟
   - 3×3 光谱灵敏度矩阵（基于 D65 光源和 Mallett2019 基函数）
   - 真实的 H&D 特性曲线模拟非线性光化学反应
   - 支持曝光补偿（EV）调整

2. **显影 (Development)** - 化学动力学
   - 分层计算 RGB 感光层的 H&D 曲线
   - 潜影转化为 CMY 染料密度

3. **扫描 (Scanning)** - Status M 密度计
   - 模拟工业标准密度计（640nm/540nm/440nm）
   - 全光谱积分计算 CMY 染料吸收
   - 正确再现橙色色罩物理特性

4. **反相 (Inversion)** - 正片渲染
   - 片基锁定反相算法
   - 自动中和色罩，生成正片密度

### 📸 RAW 图像支持
- **WASM 解码器**: 集成 `libraw-mini`（LibRaw 的 WebAssembly 移植版）
- **支持格式**: ARW (Sony), CR2 (Canon), NEF (Nikon), DNG, RAF, ORF 等
- **压缩支持**: 处理各厂商的专有压缩格式（如 Sony Compressed RAW）
- **线性工作流**: 
  - RAW → sRGB (LibRaw 解码) → Linear (逆 Gamma) → 胶片模拟 → sRGB (显示)
  - 保持最高精度的色彩 and 细节

### 🎨 内置胶片档案
包含 16+ 种专业胶片预设，数据来自[agx-emulsion](https://github.com/sobotka/agx-emulsion)：
- Kodak Portra 400/800
- Kodak Vision3 500T
- Fujifilm Pro 400H
- 等等...

---

## 🔄 完整处理流程

```
用户上传图像
     ↓
┌────────────────┐
│ 图像加载与解码 │
└────────────────┘
     ↓
┌─────────────────────────────────────────┐
│ RAW 文件？                               │
├─────────────┬───────────────────────────┤
│ YES         │ NO (JPG/PNG)              │
│             │                           │
│ LibRaw WASM │ createImageBitmap/Image   │
│ ↓           │ ↓                         │
│ sRGB 8-bit  │ sRGB 8-bit                │
│ RGBA        │ RGBA                      │
└─────────────┴───────────────────────────┘
     ↓
┌────────────────┐
│ 逆 Gamma 2.2   │  (转换为线性光空间)
│ sRGB → Linear  │
└────────────────┘
     ↓
┌────────────────────────────────────────┐
│ 胶片模拟引擎 (SimulationEngine)        │
├────────────────────────────────────────┤
│ 1. Exposure:  线性 RGB → 光谱响应     │
│              (3×3 矩阵 + EV)           │
│ 2. Develop:   对数曝光 → CMY 密度     │
│              (H&D 曲线插值)            │
│ 3. Scan:      CMY 吸收 → RGB 透光率   │
│              (Status M 密度计)         │
│ 4. Invert:    负片 → 正片密度         │
│              (片基锁定反相)            │
└────────────────────────────────────────┘
     ↓
┌────────────────┐
│ Gamma 校正     │  (转换为显示空间)
│ Linear → sRGB  │  Density → Brightness
└────────────────┘
     ↓
Canvas 显示 (自适应尺寸)
```

---

## 🚀 快速开始

### 安装依赖
```bash
npm install
```

### 启动开发服务器
```bash
npm run dev
```
访问 `http://localhost:3000`

### 构建生产版本
```bash
npm run build
```

---

## 📁 项目架构

```
src/
├── app/
│   └── page.tsx              # 主界面（图像上传、RAW 解码、显示）
├── lib/
│   ├── simulation/
│   │   ├── engine.ts         # 核心物理引擎
│   │   ├── spectral.ts       # 光谱计算
│   │   └── colorimetry.ts    # 色度学数据
│   └── types.ts              # 类型定义
public/
└── profiles/                 # 胶片预设 JSON
    ├── kodak_portra_400.json
    ├── kodak_vision3_500t.json
    └── ...
```

### 关键技术栈
- **前端框架**: Next.js 16 + React 19 + TypeScript
- **RAW 解码**: libraw-mini (WebAssembly)
- **构建工具**: Webpack (支持 WASM)
- **部署**: 纯静态站点，可部署到 Vercel/Netlify/GitHub Pages

---

## 🛠️ 开发者选项

### 导入新胶片数据
如需从原始 `agx-emulsion` 库导入新的胶片数据：

1. **设置 Python 环境**:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install colour-science numpy scipy
   ```

2. **运行导入脚本**:
   ```bash
   .venv/bin/python scripts/import_agx.py data/agx-emulsion/agx_emulsion/data/film
   ```

---


## 📖 参考资料
- [LibRaw](https://www.libraw.org/) - RAW 图像解码库
- [agx-emulsion](https://github.com/sobotka/agx-emulsion) - 胶片物理数据源
- [Colour Science](https://www.colour-science.org/) - 色彩科学计算库

---

## 📄 许可证
MIT License

## 🙏 致谢
感谢 `agx-emulsion` 项目提供的高质量胶片物理数据。
