# Saltline｜P1 中文移动端局域网版

## 源码和联机方式

上游为 [CandGo/3A-online-web 的 zh-multiplayer 分支](https://github.com/CandGo/3A-online-web/tree/4917695dde734010969cc5f7e665acb4d61e06e7)，固定提交为 `4917695dde734010969cc5f7e665acb4d61e06e7`。房间协议来自上游 `server/rooms.js`，合作和对抗沿用上游游戏流程及房主权威模拟。浏览器产生的位姿、射击、交互经中继发送给房主。房主把玩家和敌人快照、任务事件、战斗结果传给房内其他玩家。退出房主会结束房间。对局中途重连与房主迁移是待扩展功能。

安卓主机只开一个 LAN Game Hub 端口。Saltline 客户端加载 `/games/saltline/`，从 `/api/saltline/rooms` 查找公开房，并连接同源的 `/ws/saltline`。大厅使用以 S 开头的四位房间码辨认 Saltline，可按码加入私密房。管理面板可以查看和解散房间。游戏安装后可在断开互联网的 Wi-Fi 或热点上运行。构建器移除了公网信令模块和网段扫描入口。联机使用同一个预加载的港区地图，避免手机加入房间时重复生成场景。

使用手机时，左侧摇杆控制移动，右半屏滑动转向。按住开火键可以边开火边拖动视角。瞄准键为开关，另有换弹、跳跃、冲刺、蹲伏、近战、交互和暂停。设置里的触控布局调整会保存在当前浏览器。默认手机画质为低，帧率上限为 30，渲染比例为 65%。浏览器允许时，开始行动或加入房间会请求全屏和锁定横屏。其他浏览器可通过旋转手机切换横屏。桌面仍支持鼠标键盘和原有游戏手柄操作。

## 桌面构建与测试

在仓库根目录运行，需先安装 DeskPark 构建依赖。把源目录替换成已有的 CandGo 仓库路径。

```bash
npm --prefix games/deskpark ci
npm --prefix games/deskpark run build
runtime="$(mktemp -d)"
mkdir -p "$runtime/web"
cp -R games/deskpark/apps/web/dist/. "$runtime/web/"
cp games/deskpark/apps/server/dist/main.js "$runtime/server.mjs"
node scripts/stage-saltline.mjs /tmp/saltline-upstream "$runtime"
LAN_HUB=1 PORT=8787 STATIC_DIR="$runtime/web" node "$runtime/server.mjs"
```

另开终端，将实例地址替换成主机实际 IPv4。加入页、设置和联机用浏览器测试覆盖。需要 Python Playwright、Chromium 和 websockets。无硬件加速的 Linux 上可以用 `--software`，浏览器启动时仍验证 WebGL，此选项随后暂停画面绘制以便检查输入、模拟和消息链路。

```bash
python -B tests/saltline_protocol.py http://192.168.1.2:8787
python -B tests/saltline_browser.py http://192.168.1.2:8787
```

## 两台真实设备验收

1. Android 主机安装含 Saltline 的测试包，点击「启动服务」。连入同一 Wi-Fi 或热点，在该网络与公网断开后刷新游戏页面。
2. 在 Android Chrome 横屏打开大厅，创建公开合作房。在第二台真机使用 Safari、Firefox 或其他常用移动浏览器，从同一个大厅按码加入；再换成私密房核对列表中的隐藏与按码加入。
3. 双方只使用手机触控完成移动、视角滑动、瞄准、射击、换弹、跳跃、冲刺与中继交互。用一个手指移动的同时，用其他手指转向并开火。核对双方位置、射击反馈、敌人血量、中继进度、撤离和结算一致。
4. 开团队对抗验证分队、击杀、阵亡重生、比分与结算。验证房主退出时另一台设备能返回菜单并看到中文提示。
5. 覆盖短横屏和有刘海的横屏。检查按钮不被遮挡、布局和画质选项刷新后正确恢复，记录浏览器版本、机型和帧率。再使用桌面浏览器验证键鼠和房间互通。
