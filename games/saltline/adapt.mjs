import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function patchSaltline(root) {
  function replace(source, anchor, content) {
    if (typeof anchor === 'string') {
      const first = source.indexOf(anchor);
      if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0) {
        throw new Error('源码锚点不唯一：' + anchor);
      }
      return source.slice(0, first) + content + source.slice(first + anchor.length);
    }
    if (!anchor.test(source)) throw new Error('缺少源码锚点：' + anchor);
    return source.replace(anchor, () => content);
  }
  async function edit(path, changes) {
    const file = join(root, path);
    const source = await readFile(file, 'utf8');
    await writeFile(file, changes.reduce((current, [anchor, content]) => replace(current, anchor, content), source));
  }

  await edit('server/rooms.js', [
    [/function randomSeed\(\) \{[\s\S]*?\n\}/, 'const HUB_MAP_SEED = 4207;'],
    [/seed: Number.isSafeInteger\(seed\) [^\n]*/, 'seed: HUB_MAP_SEED, // 所有客户端预加载同一港区，握手后无需在手机上重新建图。'],
    [/createNewRoom\(conn, \{ seed, mode, visibility \}\)/g, 'createNewRoom(conn, { mode, visibility })'],
    ['    const seed = Number(msg.seed);\n', ''],
    [/      seed: undefined,[^\n]*\n/, ''],

    ['if (ws.readyState !== 1 /* OPEN */) return;', `if (ws.readyState !== 1 /* OPEN */) return;
    if (ws.bufferedAmount > 256 * 1024) {
      ws.terminate();
      return;
    }`],
    [/    let code = makeRoomCode\(\);\n    while \(roomsByCode.has\(code\)\) code = makeRoomCode\(\);/, `    let code;
    do { code = "S" + makeRoomCode().slice(1); } while (roomsByCode.has(code));`],
    ['    lanInfo,\n    dispose,', `    lanInfo,
    roomSummaries() {
      return [...roomsById.values()].map(room => ({
        game: "Saltline", code: room.code,
        status: room.phase === "lobby" ? "waiting" : "playing",
        players: room.players.size, capacity: MAX_PLAYERS,
      }));
    },
    closeRoom(code) {
      const room = roomsByCode.get(code);
      if (!room) return false;
      roomBroadcast(room, { t: MSG.ERROR, code: "HOST_GONE", msg: "管理员已解散房间" });
      dissolve(room, "管理员已解散房间");
      return true;
    },
    dispose,`],
  ]);

  await edit('vite.config.js', [['sourcemap: true,', 'sourcemap: false,\n    assetsInlineLimit: 0,']]);
  await edit('index.html', [
    ['    <link rel="stylesheet" href="./src/ui.css" />', '    <link rel="stylesheet" href="./src/ui.css" />\n    <link rel="stylesheet" href="./src/hub/theme.css" />'],
    ['#0b0d0f', '#111728'],
    ['>SALTLINE</div>', '>港区防线</div>'],
  ]);

  await edit('src/net/net.js', [
    [/import \{\n  createP2PSocket,[\s\S]*?from "\.\/trystero-transport\.js";/, `// LAN Game Hub 只使用同源 WebSocket。独立版的公网传输不会进入构建。
const P2P_BROWSER_RELAY_URLS = [];
const createP2PDirectory = null;
const createP2PSocket = () => { throw new Error("只支持游戏大厅局域网服务器"); };`],
    [/    if \(!loc \|\| !loc.host\) return .*\n    return .*\+ loc.host \+ "\/ws";/, `    if (!loc || !loc.host) throw new Error("请从 LAN Game Hub 启动港区防线");
    return (loc.protocol === "https:" ? "wss://" : "ws://") + loc.host + "/ws/saltline";`],
    [/    if \(transportKindValue === "p2p"\) \{\n      if \(ws &&[\s\S]*?\n    \}\n    if \(ws &&/, '    if (ws &&'],
    [/  function createRoom\(name, seedOrOpts\) \{[\s\S]*?\n  function mergePlayers/, `  function createRoom(name, options) {
    if (options?.transport === "p2p") return unavailableTransport();
    if (typeof options === "number") return roomOp("host", name, options, null, COOP, PRIVATE);
    return roomOp("host", name, options?.seed ?? null, null, normMode(options?.mode), normVis(options?.visibility));
  }
  function joinRoom(code, name, options) {
    if (options?.transport === "p2p") return unavailableTransport();
    return roomOp("client", name, null, code);
  }
  function quickJoin(mode, options) {
    if (options?.transport === "p2p") return unavailableTransport();
    return roomOp("quick", localName, null, null, mode == null ? null : normMode(mode), PUBLIC);
  }
  function unavailableTransport() {
    return Promise.reject(new Error("只支持游戏大厅局域网服务器"));
  }

  function mergePlayers`],
  ]);

  await edit('src/ui/menus.js', [
    [/import \{ DEFAULT_PORT[^\n]*\nimport \{ scanLan[^\n]*/, 'import { installHubSettings, wireHubMenu } from "../hub/settings.js";'],
    ['    if (v) return v;', `    if (v) return v;
    const hubName = JSON.parse(localStorage.getItem("park.profile") || "{}").name;
    if (typeof hubName === "string" && hubName.trim()) {
      const name = hubName.trim().slice(0, 16);
      localStorage.setItem(MP_NAME_KEY, name);
      return name;
    }`],
    [/  var LAN_SCAN_TIMEOUT = [\s\S]*?\n  function lanSubnetErr/, '  function lanSubnetErr'],
    [/  function lanStartScan\(subnet\) \{[\s\S]*?\n  function lanRescanManual/, `  function lanStartScan() {
    if (lanScanning) return;
    const gen = ++lanGen;
    lanResetUI();
    lanScanning = true;
    lanOk.disabled = true;
    lanOk.textContent = "刷新中…";
    lanBox.hidden = false;
    lanStatEl.textContent = "正在读取大厅房间…";
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 15000);
    fetch("/api/saltline/rooms", { signal: request.signal, cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then(info => {
        const list = Array.isArray(info.roomList) && info.roomList.length ? [{ ip: "同一大厅", info }] : [];
        lanScanDone(gen, null, "hub", list);
      })
      .catch(error => {
        console.warn("[Saltline] 读取大厅房间失败", error);
        lanScanDone(gen, new Error("暂时无法读取大厅房间，请重试"), "hub", null);
      })
      .finally(() => clearTimeout(timeout));
  }
  function lanRescanManual`],
    [/自动发现/g, '刷新房间'],
    ['未发现房间，检查房主服务器是否已启动', '当前没有房间。可以创建房间，或凭房间码加入。'],
    ['鼠标灵敏度', '视角灵敏度'],
    ['<dt>命中率</dt><dd data-f="acc">', '<dt data-f="acc-label">命中率</dt><dd data-f="acc">'],
    ['          renderTeam(team));', '          (c("acc-label").textContent = team?.length ? "房主命中率" : "命中率"),\n          renderTeam(team));'],
    ['所有场景、机械与音效均在你的浏览器中实时生成，不下载任何资源。', '同一局域网的玩家可用房间码加入。'],
    ['if (D === "deploy" || D === "mp-start" || D === "redeploy")', 'if (["deploy", "mp-start", "redeploy", "join-confirm", "quick-join", "lan-join"].includes(D))'],
    ['<h1 class="m-word">SALTLINE</h1>', '<h1 class="m-word">港区防线</h1>'],
    [/<kbd>Mouse<\/kbd>/g, '<kbd>鼠标</kbd>'],
    [/<kbd>LMB<\/kbd>/g, '<kbd>左键</kbd>'],
    [/<kbd>RMB<\/kbd>/g, '<kbd>右键</kbd>'],
    [/<kbd>Space<\/kbd>/g, '<kbd>空格</kbd>'],
    ['      U && U.catch && U.catch(() => {});', '      Promise.resolve(U).then(() => screen.orientation?.lock?.("landscape")).catch(() => {});'],
    ['摇杆推满即冲刺', '按住「冲刺」，或向前推满摇杆'],
    ['在中继旁按住「使用」', '在中继旁按住「交互」'],
    ['  return (g(), q);', `  installHubSettings(s.querySelector('[data-pane="settings"]'), context);
  wireHubMenu(s, (action, code) => {
    if (action === "host") return openHost();
    if (action !== "join") return;
    openJoin();
    if (code) {
      joinInput.value = code;
      joinInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    lanStartScan();
  });
  return (g(), q);`],
  ]);

  await edit('src/input/input.js', [
    ['var If = 58;\n\n', ''],
    ['function createInput(context) {', 'import { createTouchControls, refreshTouchLayout } from "../hub/touch.js";\n\nfunction createInput(context) {'],
    ['"Touch controls active"', '"触屏操控已启用"'],
    [/\? "Mouse capture unavailable .*?"\n/, '? "当前浏览器无法锁定鼠标。移动鼠标或按方向键转向，点击开火。"\n'],
    [/"Mouse captured .*?"/, '"鼠标已锁定，按 Esc 释放"'],
    ['"Click the view to capture the mouse"', '"点击游戏画面锁定鼠标"'],
    ['    (n.clear(),', '    (n.clear(), s.clear(),'],
    ['M.btn.ads.classList.remove("active"), ie()', 'Object.values(M.btn).forEach(button => button.classList.remove("active")), ie()'],
    [/    let P = document.createElement\("div"\);\n    \(\(P.className = "touch"\),[\s\S]*?    for \(let L in Y.btn\)/, `    const Y = createTouchControls(t);
    bindTouchSurface(Y.stick, true);
    for (let L in Y.btn)`],
    [/  \(addEventListener\(\n    "touchstart",[\s\S]*?  let X = \{/, `  addEventListener("touchstart", () => { E = performance.now(); K(); }, { passive: true, capture: true });
  function bindTouchSurface(surface, joystick) {
    const options = { passive: false };
    surface.addEventListener("touchstart", event => {
      if (!r) return;
      event.preventDefault();
      for (const finger of event.changedTouches) {
        if (joystick && w < 0) {
          const rect = surface.getBoundingClientRect();
          w = finger.identifier;
          S = rect.left + rect.width / 2;
          z = rect.top + rect.height / 2;
          M.stick.classList.add("on");
          moveStick(finger);
        } else if (!joystick && q < 0 && finger.clientX >= innerWidth * 0.43) {
          q = finger.identifier;
          U = finger.clientX;
          T = finger.clientY;
        }
      }
    }, options);
    surface.addEventListener("touchmove", event => {
      if (!r) return;
      event.preventDefault();
      for (const finger of event.changedTouches) {
        if (finger.identifier === w) moveStick(finger);
        if (finger.identifier === q) {
          Q(finger.clientX - U, finger.clientY - T);
          U = finger.clientX;
          T = finger.clientY;
        }
      }
    }, options);
    function release(event) {
      for (const finger of event.changedTouches) {
        if (finger.identifier === w) ie();
        if (finger.identifier === q) q = -1;
      }
    }
    surface.addEventListener("touchend", release, options);
    surface.addEventListener("touchcancel", release, options);
  }
  function moveStick(finger) {
    const x = finger.clientX - S;
    const y = finger.clientY - z;
    const radius = M.stick.offsetWidth * 0.38;
    const divisor = Math.max(radius, Math.hypot(x, y));
    H = x / divisor;
    O = -y / divisor;
    M.nub.style.transform = \`translate3d(\${H * radius}px,\${-O * radius}px,0)\`;
  }
  bindTouchSurface(e, false);
  document.addEventListener("visibilitychange", () => { if (document.hidden) v(); });
  if (matchMedia("(pointer: coarse)").matches) K();
  let X = {`],
    ['    ((w = -1), (H = O = 0), M && M.stick.classList.remove("on"));', `    w = -1;
    H = O = 0;
    if (M) {
      M.stick.classList.remove("on");
      M.nub.style.transform = "";
    }`],
    ['      M.root.classList.toggle("on", r),', '      refreshTouchLayout(),\n      M.root.classList.toggle("on", r),'],
  ]);

  await edit('src/app/runtime.js', [
    ['  let context = {', '  delete params.seed; // 和大厅使用同一个预加载港区。\n  let context = {'],

    ['params.q || (params.shot ? "test" : "")', 'params.q || (params.shot ? "test" : matchMedia("(pointer: coarse)").matches ? "low" : "")'],
    ['  let step = (p, opts) => {', '  let nextDraw = 0, drawTime = 0;\n  let step = (p, opts) => {'],
    ['    params.dt && (p = +params.dt);', `    if (render) {
      drawTime += p;
      const now = performance.now();
      const interval = context.hubVideo?.fps ? 1000 / context.hubVideo.fps : 0;
      render = !interval || now >= nextDraw - 0.5;
      if (render) nextDraw = (nextDraw && now - nextDraw < interval ? nextDraw : now) + interval;
      if (!interval) nextDraw = 0;
    }
    params.dt && (p = +params.dt);`],
    ['    (render &&\n      context.game.state !== "paused" &&', `    const visualDelta = Math.min(drawTime, 0.1);
    if (render) drawTime = 0;
    (render &&
      context.game.state !== "paused" &&`],
    ...['fx', 'ground', 'level', 'backdrop', 'mats', 'hud'].map(system =>
      [`updateSystem("${system}", p)`, `updateSystem("${system}", visualDelta)`]),
    ['        context.render.frame(p);', '        context.render.frame(visualDelta);'],
  ]);
  await edit('src/core/config.js', [
    [/  low: \{[\s\S]*?\n  \},/, `  low: {
    name: "low",
    scale: 0.7,
    msaa: 0,
    shadow: 768,
    tex: 256,
    volSteps: 6,
    ao: false,
    planar: 0,
    bloom: false,
    motionBlur: false,
    rain: 0.3,
  },`],
  ]);
  await edit('src/render/renderer.js', [
    ['ne = context.quality.scale || 1;', 'ne = (context.quality.scale || 1) * (context.hubVideo?.scale ?? 1);'],
    ['Math.min(window.devicePixelRatio || 1, 2)', 'Math.min(window.devicePixelRatio || 1, context.quality.name === "low" ? 1.5 : 2)'],
    ['D && z(F - D)', 'D && !context.hubVideo?.fps && z(F - D)'],
  ]);
  await edit('src/app/diagnostics.js', [
    ['"Saltline could not start: " + i', '"港区防线启动失败。请重新打开页面，并检查浏览器是否支持 WebGL 2。"'],
  ]);
  await edit('src/game/flow.js', [
    ['      players: stats.players,', `      team: (stats.players || []).map(player => ({
        ...player, you: player.id === netApi()?.selfId(),
      })),`],
  ]);
  await edit('src/game/pvp.js', [
    ['队伍先达二十杀，或撑满五分钟。', '率先达成二十次击杀的队伍获胜。'],
  ]);
  await edit('src/ui/hud.js', [['? "USE"', '? "交互"']]);
}
