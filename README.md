粒子圣诞树交互系统 (Particle Christmas Tree System)

这是一个基于 Web 技术构建的交互式 3D 视觉项目，结合了现代 3D 渲染与 AI 视觉识别技术。

🌟 主要功能

3D 粒子渲染：使用 Three.js 生成 12,000 个动态粒子，构建具有发光效果的圣诞树。

后期特效：应用 UnrealBloom 高级发光滤镜，呈现电影级的视觉质感。

AI 手势交互：集成 Google MediaPipe Hands，支持通过摄像头进行空间交互：

缩放控制：通过张开/合拢手指（拇指与食指距离）来控制圣诞树的大小。

旋转控制：通过移动手掌位置来实时改变 3D 模型的观察角度。

响应式 UI：基于 Tailwind CSS 构建的高端、极简交互界面。

🛠️ 技术栈

React: 框架层

Three.js: 3D 引擎

MediaPipe Hands: AI 视觉追踪

Tailwind CSS: 样式管理

Lucide React: 矢量图标

🚀 运行与安装

安装依赖：
确保你的项目中已安装以下 npm 包：

npm install three lucide-react


注：MediaPipe 手势库通过 CDN 动态加载，无需额外安装。

使用组件：
将 ChristmasTree.jsx 文件放入你的 React 项目中并引用即可。

环境要求：

支持 WebGL 的现代浏览器。

具有摄像头权限（用于手势交互功能）。

📝 开发者备注

本项目采用了 Single-File Pattern，所有的逻辑、样式与渲染代码均集成在一个文件中，便于快速部署和预览。

修复了此前存在的语法闭合错误（ESBuild Error），确保了异步追踪逻辑的稳定性。

以下是直接访问路径：
https://gemini.google.com/share/d1f2096400fe
