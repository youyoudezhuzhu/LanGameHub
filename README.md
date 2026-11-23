# LAN Game Hub

局域网棋牌盒子。由一台 Android 设备开启服务，其他设备在同一个 Wi‑Fi 或热点内通过浏览器加入。

当前为 **0.1.0 调试版**。安装 APK，点击「启动服务」，从同一局域网扫码或打开邀请链接。提供斗地主、掼蛋、德州扑克、四川麻将、中国象棋、国际象棋、魔法出包、UON、卡旦岛、宝石商会。每款游戏都可建房联机，并可在浏览器单人练习。

## 构建

需要 Linux/macOS、JDK 17+、Node.js 22.12+、npm、Android SDK 平台 API 35、Build Tools 35.0.0 和 NDK 28.2.13676358。首次构建联网取得固定版本的依赖，安装后的 APK 从本地资源启动。

```sh
export ANDROID_HOME=/path/to/android-sdk
sdkmanager 'platforms;android-35' 'build-tools;35.0.0' 'ndk;28.2.13676358'
./scripts/build-apk.sh
```

默认产物位于 `android/app/build/sdk/LAN-Game-Hub-debug.apk`。可将输出路径作为第一个参数。Android Studio 可打开 `android/`，也可尝试使用 `cd android && ./gradlew assembleDebug`。Gradle 配置与 SDK 脚本共用同一资源构建步骤。本次交付 APK 由 SDK 脚本构建，自动化环境的 Gradle 插件依赖解析未完成。

没有完整 JDK 的构建机可以将 `HUB_ECJ_JAR` 指向 Eclipse ECJ 3.40.0 的 JAR，SDK 脚本将使用 ECJ 编译。已准备 npm 依赖时，可使用 `HUB_SKIP_NPM_CI=1` 避免重复安装。Node.js Mobile 预编译包和 ZXing JAR 均通过固定 SHA‑256 校验。`HUB_DEBUG_KEYSTORE` 可指定已有 Android 调试密钥库。

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
- [来源和许可证清单](docs/许可证.md)
- [测试报告及真机验收步骤](docs/测试报告.md)
