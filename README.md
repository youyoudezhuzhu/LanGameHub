# LAN Game Hub

局域网棋牌盒子。由一台 Android 设备开启服务，其他设备在同一个 Wi‑Fi 或热点内通过浏览器加入。

当前为 **0.3.1 调试版**。安装 APK，点击「启动服务」，从同一局域网扫码或打开邀请链接。提供斗地主、掼蛋、德州扑克、四川麻将、中国象棋、国际象棋、魔法出包、UON、卡旦岛、宝石商会。十款桌游和原创实时竞技游戏「流光蛇场」均可建房联机，并可在浏览器单人练习。

十二款玩法全部支持横竖屏：手机竖着拿和横过来都有对应的布局，旋转屏幕即时重排，不用刷新。大厅、牌桌和设置面板都可以一键进入全屏。唯一的例外是射击玩法「港区防线」（Saltline），它只提供横屏布局，竖屏时会提示旋转手机。

**主机自己玩也在 App 里**：点「进入大厅」不再跳外部浏览器，而是用内置 WebView 直接加载本机服务。页面常驻前台，服务进程就不会被系统回收，全屏和横屏也由原生层接管。练牌时右下角有一个半透明的「主机」按钮，点它随时切回原生设置界面看二维码 / 端口 / 诊断；按返回键回到刚才那局，对局状态不会丢。

## 构建

需要 Linux/macOS、JDK 17+、Node.js 22.12+、npm、Android SDK 平台 API 35、Build Tools 35.0.0 和 NDK 28.2.13676358。首次构建联网取得固定版本的依赖，安装后的 APK 从本地资源启动。

```sh
export ANDROID_HOME=/path/to/android-sdk
sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'ndk;28.2.13676358'
./scripts/build-apk.sh
```

默认产物位于 `android/app/build/sdk/LAN-Game-Hub-debug.apk`。可将输出路径作为第一个参数。Android Studio 可打开 `android/`，也可尝试使用 `cd android && ./gradlew assembleDebug`。Gradle 配置与 SDK 脚本共用同一资源构建步骤。本次交付 APK 由 SDK 脚本构建，自动化环境的 Gradle 插件依赖解析未完成。

没有完整 JDK 的构建机可以将 `HUB_ECJ_JAR` 指向 Eclipse ECJ 3.40.0 的 JAR，SDK 脚本将使用 ECJ 编译。已准备 npm 依赖时，可使用 `HUB_SKIP_NPM_CI=1` 避免重复安装。Node.js Mobile 预编译包和 ZXing JAR 均通过固定 SHA‑256 校验。

签名固定用仓库里的 `android/keystore/langamehub.jks`，每次编译出来的 APK 签名一致，**新版本可以直接覆盖安装旧版本，不用卸载**。换密钥用 `HUB_KEYSTORE` / `HUB_KEYSTORE_PASSWORD` / `HUB_KEY_ALIAS` / `HUB_KEY_PASSWORD` 覆盖，细节见 [签名说明](android/keystore/README.md)。

### 自用构建中导入 pvz_perf

默认 APK 包含 11 款游戏。若已有可合法使用的完整 pvz_perf 上游离线 Web 包，将其解包在项目生成目录外，构建时设置 `HUB_PVZ_WEB_DIR`。保留 `web-build-manifest.json`、WebGL 2/Wasm32 运行时和配套的 `pvz-perf.data`。Bilibili 发行版、无资源版及清单校验失败的包会被拒绝。

```sh
HUB_PVZ_WEB_DIR=/absolute/path/to/pvz-perf-offline ./scripts/build-apk.sh
```

导入后，游戏库的「街机」分类提供 pvz_perf 单人入口。游戏由当前浏览器运行。玩家可先在游戏中退出保存，再点「返回大厅」。项目默认构建和公开发行都无需 PvZ 素材，也不会下载它们。

### 自用构建中导入 Saltline

局域网联机适配基于 CandGo 的 `zh-multiplayer` 分支，保留单人任务、合作和团队对抗。构建器从指定提交读取源码并打补丁，构建好的网页、字体和房间中继随 APK 安装。默认构建不含 Saltline。

```sh
git clone --branch zh-multiplayer https://github.com/CandGo/3A-online-web.git /tmp/saltline-upstream
HUB_SALTLINE_SOURCE=/tmp/saltline-upstream ./scripts/build-apk.sh
```

使用有权使用的源码。浏览器从游戏库的「街机」分类进入 Saltline。在同一个大厅输入房间码可跳转到加入页，公开房也可在 Saltline 内刷新查找。本作只支持横屏（其他棋牌玩法支持竖屏），在「设置」里可调整画质、帧率、渲染比例与触控布局。验收进度与真机步骤见 [Saltline P1](docs/Saltline-P1.md)。

## 桌面开发和测试

```sh
cd games/deskpark
npm ci
npm run build
npm run typecheck
CI=1 npm test
LAN_HUB=1 HOST=0.0.0.0 PORT=8787 STATIC_DIR="$PWD/apps/web/dist" node apps/server/dist/main.js
```

生产模式测试使用机器的 IPv4 地址。仓库根目录下的 `tests/lan_protocol.py` 需要 Python 3.11+ 和 websockets 16，`tests/browser_smoke.py` 需要 Playwright 和 Chromium。运行命令及验收范围见 [测试报告](docs/测试报告.md)。

## 文档

- [研发阶段、上游差异与接入边界](docs/调研与实施边界.md)
- [Android、网页和联机架构](docs/架构.md)
- [内置大厅与固定签名（WebView 常驻前台、覆盖安装）](docs/内置大厅与签名.md)
- [横竖屏适配（12 款玩法的双布局与验收）](docs/横竖屏适配.md)
- [掼蛋规则对照（本地打法 vs 合集引擎）](docs/掼蛋规则对照.md)
- [来源和许可证清单](docs/许可证.md)
- [0.2.0 测试报告与剩余验收](docs/测试报告-v0.2.0.md)
- [0.1.0 测试报告及真机验收步骤](docs/测试报告.md)
