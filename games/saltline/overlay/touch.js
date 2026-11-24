export const controls = {
  stick: ['摇杆', 15, 72, 96],
  sprint: ['冲刺', 27, 49, 46],
  crouch: ['蹲伏', 27, 71, 46],
  melee: ['近战', 65, 58, 46],
  interact: ['交互', 64, 78, 50],
  ads: ['瞄准', 75, 83, 49],
  reload: ['换弹', 76, 63, 49],
  jump: ['跳跃', 85, 50, 49],
  fire: ['开火', 91, 74, 68],
  pause: ['暂停', 96, 10, 46],
};

const key = 'hub.saltline.touch.v1';
let values;
try { values = JSON.parse(localStorage.getItem(key)); } catch {}
let live;

export function getLayout(action) {
  const [, x, y, size] = controls[action];
  const defaults = { x, y, size, opacity: 75 };
  return Object.fromEntries(Object.entries(defaults).map(([field, normal]) => {
    const bounds = field === 'size' ? [44, 144] : field === 'opacity' ? [35, 100] : [0, 100];
    const value = values?.[action]?.[field];
    return [field, Number.isFinite(value) ? Math.min(bounds[1], Math.max(bounds[0], value)) : normal];
  }));
}

export function setLayout(action, layout) {
  values = action ? { ...values, [action]: layout } : {};
  try { localStorage.setItem(key, JSON.stringify(values)); } catch {}
  refreshTouchLayout();
}

export function styleControl(element, action) {
  const { x, y, size, opacity } = getLayout(action);
  element.style.setProperty('--control-x', x + '%');
  element.style.setProperty('--control-y', y + '%');
  element.style.setProperty('--control-size', size + 'px');
  element.style.setProperty('--control-opacity', opacity / 100);
}

export function refreshTouchLayout() {
  if (!live) return;
  styleControl(live.stick, 'stick');
  for (const [action, button] of Object.entries(live.btn)) styleControl(button, action);
}

export function createTouchControls(parent) {
  const root = document.createElement('div');
  root.className = 'touch hub-touch';
  const stick = document.createElement('div');
  stick.className = 't-stick';
  stick.setAttribute('aria-label', '移动摇杆');
  const nub = document.createElement('i');
  nub.className = 't-nub';
  stick.append(nub);
  root.append(stick);
  const btn = {};
  for (const [action, [label]] of Object.entries(controls)) {
    if (action === 'stick') continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 't-btn t-' + action;
    button.dataset.a = action;
    button.textContent = label;
    root.append(button);
    btn[action] = button;
  }
  parent.append(root);
  live = { root, stick, nub, btn };
  refreshTouchLayout();
  return live;
}
