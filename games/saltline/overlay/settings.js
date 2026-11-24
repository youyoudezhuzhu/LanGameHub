import { controls, getLayout, setLayout, styleControl } from './touch.js';

const videoKey = 'hub.saltline.video.v1';
const mobile = matchMedia('(pointer: coarse)').matches;
const rates = [0, 30, 45, 60];
const scales = [0.5, 0.65, 0.8, 1];
const touchFields = [
  ['x', '左右位置', 0, 100, '%'],
  ['y', '上下位置', 0, 100, '%'],
  ['size', '大小', 44, 144, ' 像素'],
  ['opacity', '透明度', 35, 100, '%'],
];

export function installHubSettings(panel, context) {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(videoKey)); } catch {}
  const video = context.hubVideo = {
    fps: rates.includes(stored?.fps) ? stored.fps : mobile ? 30 : 0,
    scale: scales.includes(stored?.scale) ? stored.scale : mobile ? 0.65 : 1,
  };
  const settings = document.createElement('div');
  settings.className = 'hub-settings';
  settings.innerHTML = `
    <div class="row"><label for="hub-fps">帧率上限</label><select id="hub-fps">${rates.map(fps =>
      `<option value="${fps}">${fps ? fps + ' 帧/秒' : '随浏览器刷新率'}</option>`).join('')}</select></div>
    <div class="row"><label for="hub-scale">渲染比例</label><select id="hub-scale">${scales.map(scale =>
      `<option value="${scale}">${Math.round(scale * 100)}%</option>`).join('')}</select></div>
    <section class="hub-layout">
      <h3>触控布局</h3>
      <label for="hub-control">调整控件</label>
      <select id="hub-control">${Object.entries(controls).map(([action, [label]]) =>
        `<option value="${action}">${label}</option>`).join('')}</select>
      <div class="hub-layout-preview" aria-hidden="true">
        ${Object.entries(controls).map(([action, [label]]) => `<span data-preview="${action}">${label}</span>`).join('')}
      </div>
      ${touchFields.map(([field, label, min, max]) =>
        `<div class="row"><label for="hub-${field}">${label}</label><div class="slider">
        <input id="hub-${field}" type="range" min="${min}" max="${max}"><output for="hub-${field}"></output>
        </div></div>`).join('')}
      <button type="button" class="btn small hub-reset">恢复默认布局</button>
    </section>`;
  const find = selector => settings.querySelector(selector);
  const selection = find('#hub-control');
  for (const field of ['fps', 'scale']) {
    const input = find('#hub-' + field);
    input.value = video[field];
    input.addEventListener('change', () => {
      video[field] = Number(input.value);
      try { localStorage.setItem(videoKey, JSON.stringify(video)); } catch {}
      context.render?.resize();
    });
  }
  const refresh = () => {
    const action = selection.value;
    const layout = getLayout(action);
    for (const [field, , , , unit] of touchFields) {
      const input = find('#hub-' + field);
      input.value = layout[field];
      input.nextElementSibling.value = layout[field] + unit;
    }
    for (const preview of settings.querySelectorAll('[data-preview]')) {
      styleControl(preview, preview.dataset.preview);
      preview.classList.toggle('selected', preview.dataset.preview === action);
    }
  };
  selection.addEventListener('change', refresh);
  for (const [field] of touchFields) {
    const input = find('#hub-' + field);
    input.addEventListener('input', () => {
      setLayout(selection.value, { ...getLayout(selection.value), [field]: Number(input.value) });
      refresh();
    });
  }
  find('.hub-reset').addEventListener('click', () => { setLayout(); refresh(); });
  panel.append(settings);
  refresh();
  context.render?.resize();
}

export function wireHubMenu(menu, open) {
  for (const name of ['title', 'paused', 'lobby', 'complete', 'roundend', 'dead']) {
    const actions = menu.querySelector(`[data-s="${name}"] .m-actions`);
    if (!actions) continue;
    const link = document.createElement('a');
    link.className = 'btn hub-return';
    link.href = '/';
    link.textContent = '返回游戏大厅';
    actions.append(link);
  }
  const landscape = document.createElement('p');
  landscape.className = 'hub-landscape';
  landscape.textContent = '建议横屏操作。请旋转手机。';
  menu.querySelector('.m-title-main').prepend(landscape);
  const params = new URLSearchParams(location.search);
  const code = params.get('room')?.toUpperCase();
  const action = /^S[A-Z0-9]{3}$/.test(code ?? '') ? 'join' : params.get('action');
  if (action !== 'host' && action !== 'join') return;
  const launch = () => {
    if (menu.dataset.screen !== 'title') return false;
    open(action, code);
    return true;
  };
  // Wait until the game flow has opened its initial screen.
  queueMicrotask(() => {
    if (launch()) return;
    const observer = new MutationObserver(() => { if (launch()) observer.disconnect(); });
    observer.observe(menu, { attributes: true, attributeFilter: ['data-screen'] });
  });
}
