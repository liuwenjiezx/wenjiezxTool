// wenjiezxTool · 画布大字标注节点（WJZ_BigLabel）
// 后端 nodes.py 提供空壳定义（让含该节点的工作流能排队），本文件做前端增强。
//
// 交互设计（用户 2026-09-26 定稿）：
//   1) 画布上平时只有大字本身，干净无框；
//   2) 鼠标移到「文字范围」上 → 出现黑色圆角背景框，**完整包裹整段文字**；移开即隐藏；
//   3) 背景框右上角有一个 ⚙ 设置按钮，按钮尺寸跟着字号走（文字越大按钮越大），
//      点开面板可调：文字大小 / 文字颜色 / 字体 / 粗细 / 缩字填满（全部鼠标点击，不用记命令）；
//   4) 双击文字 → 改文字内容（\n 换行）；
//   5) ★文字随框自适应（Figma 式，2026-09-26 定稿）：
//        - 文字按**节点宽度**自动折行（中文逐字断行 + 英文整词回退 + 行首禁排标点避头尾）；
//        - 拖节点右下角「横向」→ 折行宽度变化，框高随行数自动加高（= Figma「自动高度」）；
//        - 拖节点右下角「纵向」→ 字号随高度等比缩放（谁的变化大听谁的那条轴）；
//        - 面板「缩字填满」开 → 行数超出节点高度时自动缩字号塞进框里（PowerPoint 式）；
//          关（默认）→ 节点高度自动贴合内容（Figma「自动高度」语义）。
//
// ★两个必须踩过的坑（本机 comfyui_frontend 1.53.6 / litegraph）：
//   A. `title_mode` 在原型上是**只读访问器**（getter 读 this.constructor.title_mode），
//      实例赋值 `node.title_mode = x` 在 ESM 严格模式下直接抛 TypeError（被 try/catch 吞掉后
//      标题栏照画 → 节点左上角出现一条黑底标题条）。必须设在**类**上：
//      `nodeType.title_mode = LiteGraph.NO_TITLE`（0=NORMAL,1=NO,2=TRANSPARENT,3=AUTOHIDE）。
//   B. 纯前端 registerCustomNodes 注册的节点 graphToPrompt 没有 class_type，服务端会拒收，
//      所以节点必须由后端 nodes.py 定义，这里只做 beforeRegisterNodeDef 增强。
import { app } from "../../../scripts/app.js";

const DEFAULTS = {
  text: "双击修改文字",
  fontSize: 60,
  fontFamily: "Arial",
  fontWeight: "normal",
  fontColor: "#d6fe51",
  fitFill: false, // 缩字填满：行数超出节点高度时自动缩字号
};

const PAD = 16; // 背景框内边距（文字到框边的距离）
const OX = 6;   // 背景框左上角在节点内的位置
const OY = 6;

const FONTS = [
  ["Microsoft YaHei", "微软雅黑"],
  ["SimHei", "黑体"],
  ["SimSun", "宋体"],
  ["KaiTi", "楷体"],
  ["Arial", "Arial"],
  ["Times New Roman", "Times"],
  ["Consolas", "Consolas"],
  ["Impact", "Impact"],
];

const WEIGHTS = [
  ["300", "细体"],
  ["400", "常规"],
  ["600", "中等"],
  ["700", "加粗"],
  ["900", "特粗"],
];

const COLORS = [
  "#ffffff", "#ff5f5f", "#ffb02e", "#ffd166",
  "#d6fe51", "#4ade80", "#38bdf8", "#c084fc",
];

const PANEL_W = 360;
const HEAD_H = 34;
const ROW_H = 38;
const ROWS = 5;
const FOOT_H = 30;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
let _mctx = null;
function measureCtx() {
  if (!_mctx) {
    const cv = document.createElement("canvas");
    cv.width = 8;
    cv.height = 8;
    _mctx = cv.getContext("2d");
  }
  return _mctx;
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function inRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function ensureProps(node) {
  const p = (node.properties = node.properties || {});
  for (const k of Object.keys(DEFAULTS)) {
    if (p[k] === undefined || p[k] === null) p[k] = DEFAULTS[k];
  }
  p.text = String(p.text === undefined || p.text === null ? "" : p.text);
  p.fontSize = clamp(Number(p.fontSize) || DEFAULTS.fontSize, 8, 600);
  p.fontFamily = String(p.fontFamily || DEFAULTS.fontFamily);
  p.fontWeight = String(p.fontWeight || DEFAULTS.fontWeight);
  p.fontColor = String(p.fontColor || DEFAULTS.fontColor);
  p.fitFill = p.fitFill === true;
  return p;
}

function fontIndexOf(family) {
  const i = FONTS.findIndex((f) => f[0].toLowerCase() === String(family).toLowerCase());
  return i < 0 ? 4 : i; // 找不到就当 Arial
}

function weightIndexOf(weight) {
  const i = WEIGHTS.findIndex((w) => w[0] === String(weight));
  return i < 0 ? 1 : i;
}

// ---------------------------------------------------------------------------
// 自动折行（按像素宽切，不按字数切）
//   - 中文/无空格文字：逐字符累加 measureText，超宽即断行；
//   - 英文等空格语言：整词回退，不断词；
//   - 避头尾：行首不放 ，。、；：！？）】》等收尾标点（连同前一个字符一起下移）；
//   - \n 仍是强制换行；带缓存，同一 (字体,宽,文本) 不重复排版。
// ---------------------------------------------------------------------------
const NO_LINE_START = "，。、；：！？）】》〉」』%％…·～~.,!?)]}>:;\"";
const _wrapCache = new Map();
const isWordCh = (s) => /[A-Za-z0-9_$]/.test(s);

function wrapLines(text, font, wrapW, areaW) {
  const key = font + "|" + Math.round(wrapW) + "|" + text;
  const hit = _wrapCache.get(key);
  if (hit) return hit;
  const c = measureCtx();
  c.font = font;
  const out = [];
  for (const seg of String(text).split("\n")) {
    const chars = Array.from(seg);
    if (!chars.length) { out.push(""); continue; }
    let line = "";
    let w = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const cw = c.measureText(ch).width;
      if (w + cw > wrapW && line) {
        // 避头尾：下一字符是不允许开头的标点
        if (NO_LINE_START.includes(ch)) {
          if (line.length > 1) {
            // 拉入式：把上一行末字连同标点一起移到下一行，行宽不超限
            const arr = Array.from(line);
            const last = arr.pop();
            out.push(arr.join(""));
            line = last + ch;
            w = c.measureText(line).width;
            continue;
          }
          // 上一行只剩 1 个字（极端大字号）→ 只要挤上标点后仍在文字区内就挤行尾
          const cand = line + ch;
          if (c.measureText(cand).width <= areaW) {
            out.push(cand);
            line = "";
            w = 0;
            continue;
          }
        }
        // 英文整词回退：当前行尾是一个"词"且上一处有断点 → 整词下移
        if (isWordCh(ch)) {
          let k = line.length;
          while (k > 0 && isWordCh(line[k - 1])) k--;
          if (k > 0 && k < line.length) {
            const rest = line.slice(k) + ch;
            out.push(line.slice(0, k));
            line = rest;
            w = c.measureText(rest).width;
            continue;
          }
        }
        out.push(line);
        line = ch;
        w = cw;
      } else {
        line += ch;
        w += cw;
      }
    }
    if (line) out.push(line);
  }
  if (_wrapCache.size > 400) _wrapCache.clear();
  _wrapCache.set(key, out);
  return out;
}

// 整套版面：背景框宽度 = 节点宽度（减边距），文字按框宽折行；
// fsOverride 供「缩字填满」临时用更小字号重排（不改设置值）。
// （画到哪里就点到哪里，命中判定复用同一套数字）
function layout(node, fsOverride) {
  const p = ensureProps(node);
  const fontSize = clamp(Number(fsOverride) || p.fontSize, 8, 600);
  const gear = Math.round(clamp(fontSize * 0.5, 22, 46));
  const nodeW = (node.size && node.size[0]) || 460;
  const box = { x: OX, y: OY, w: Math.max(140, nodeW - OX * 2), h: 0 };
  const wrapW = Math.max(24, box.w - PAD * 2 - gear - 10); // 右侧留出 ⚙ 的位置
  const font = `${p.fontWeight} ${fontSize}px ${p.fontFamily}`;
  const lines = wrapLines(p.text, font, wrapW, box.w - PAD * 2);
  const c = measureCtx();
  c.font = font;
  let textW = 1;
  for (const ln of lines) textW = Math.max(textW, c.measureText(ln).width);
  const lineH = Math.round(fontSize * 1.28);
  box.h = lines.length * lineH + PAD * 2;
  const gearRect = {
    x: box.x + box.w - gear - 8,
    y: box.y + PAD + Math.max(0, (Math.min(lineH, box.h - PAD * 2) - gear) / 2),
    w: gear,
    h: gear,
  };
  const panel = {
    x: box.x,
    y: box.y + box.h + 10,
    w: PANEL_W,
    h: HEAD_H + ROWS * ROW_H + FOOT_H,
  };
  return {
    lines, fontSize, weight: p.fontWeight, family: p.fontFamily, color: p.fontColor,
    textW: Math.ceil(textW), textH: lines.length * lineH, lineH,
    box, gearRect, gear, panel, textX: box.x + PAD, textY: box.y + PAD,
  };
}

// 缩字填满（PowerPoint 式）：行数超出节点高度时，从当前字号往下试，找到能塞进框的最大字号
function layoutFor(node) {
  const L = layout(node);
  if (ensureProps(node).fitFill !== true) return L;
  const availH = Math.max(40, ((node.size && node.size[1]) || L.box.h) - OY * 2);
  if (L.box.h <= availH) return L;
  for (let fs = L.fontSize - 2; fs >= 8; fs -= 2) {
    const L2 = layout(node, fs);
    if (L2.box.h <= availH) return L2;
  }
  return layout(node, 8);
}

// 自动高度（Figma「自动高度」语义）：内容变了之后节点高度贴合文字框（仅 fitFill 关闭时）
// ★实测（2026-09-26 无头探针）：程序性改 node.size[1] 不会触发 onResize（它只由用户拖拽触发），
//   所以这里不需要任何"程序改高度"保险丝——加了反而会吞掉用户下一次真实的拖拽事件。
function autoHeight(node) {
  if (!node || !node._lay || ensureProps(node).fitFill === true) return;
  const need = Math.max(40, Math.round(node._lay.box.h + OY * 2));
  if (node.size && Math.abs(node.size[1] - need) > 0.5) node.size[1] = need;
}

// ---------------------------------------------------------------------------
// 画 ⚙（矢量画，不依赖 emoji 字体，任何机器都长得一样）
// ---------------------------------------------------------------------------
function drawGear(ctx, cx, cy, r, fg, hole) {
  ctx.save();
  ctx.fillStyle = fg;
  const teeth = 8;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (Math.PI * i) / teeth - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.7;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1.6, r * 0.34), 0, Math.PI * 2);
  ctx.fillStyle = hole;
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------
function panelRows(L, node) {
  const p = ensureProps(node);
  const px = L.panel.x;
  const py = L.panel.y;
  const out = [];
  const push = (action, x, y, w, h) => out.push({ action, x, y, w, h });

  let y = py + HEAD_H;
  const cc = px + 96; // 控件区起点

  // 1) 文字大小
  let cx = cc;
  const btn = (action, text) => {
    push(action, cx, y + 6, 30, 26);
    out[out.length - 1].text = text;
    cx += 34;
  };
  btn("size--", "−10");
  btn("size-", "−");
  out.push({ action: "none", x: cx, y: y + 6, w: 52, h: 26, text: String(p.fontSize), value: true });
  cx += 56;
  btn("size+", "+");
  btn("size++", "+10");
  y += ROW_H;

  // 2) 文字颜色
  cx = cc;
  for (const col of COLORS) {
    push("color:" + col, cx, y + 8, 20, 20);
    out[out.length - 1].swatch = col;
    cx += 24;
  }
  push("color-custom", cx + 4, y + 6, 58, 24);
  out[out.length - 1].text = "自定义";
  y += ROW_H;

  // 3) 字体
  cx = cc;
  push("font-prev", cx, y + 6, 26, 26);
  out[out.length - 1].text = "◀";
  out.push({ action: "none", x: cx + 30, y: y + 6, w: 138, h: 26, text: FONTS[fontIndexOf(p.fontFamily)][1], value: true });
  cx += 172;
  push("font-next", cx, y + 6, 26, 26);
  out[out.length - 1].text = "▶";
  y += ROW_H;

  // 4) 粗细
  cx = cc;
  push("weight-prev", cx, y + 6, 26, 26);
  out[out.length - 1].text = "◀";
  out.push({ action: "none", x: cx + 30, y: y + 6, w: 138, h: 26, text: WEIGHTS[weightIndexOf(p.fontWeight)][1], value: true });
  cx += 172;
  push("weight-next", cx, y + 6, 26, 26);
  out[out.length - 1].text = "▶";
  y += ROW_H;

  // 5) 缩字填满（行数超出节点高度时自动缩字号）
  cx = cc;
  push("fit-toggle", cx, y + 6, 64, 26);
  out[out.length - 1].toggle = true;

  // 页脚：关闭
  push("close", px + PANEL_W - 84, py + HEAD_H + ROWS * ROW_H + 4, 70, 24);
  out[out.length - 1].text = "✕ 关闭";

  return out;
}

function drawPanel(ctx, L, node) {
  const p = ensureProps(node);
  const { x, y, w, h } = L.panel;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  rrect(ctx, x, y, w, h, 10);
  ctx.fillStyle = "rgba(24,26,34,0.97)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();

  // 标题
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = '13px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "#cfd8e3";
  ctx.fillText("大字设置", x + 34, y + HEAD_H / 2 + 1);
  drawGear(ctx, x + 18, y + HEAD_H / 2, 7, "#d6fe51", "rgba(24,26,34,1)");
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(x + 8, y + HEAD_H - 0.5);
  ctx.lineTo(x + w - 8, y + HEAD_H - 0.5);
  ctx.stroke();

  const hit = [];
  const rows = panelRows(L, node);
  const labelOf = ["文字大小", "文字颜色", "字体", "粗细", "缩字填满"];
  for (let i = 0; i < ROWS; i++) {
    const ry = y + HEAD_H + i * ROW_H;
    if (i % 2 === 1) {
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(x + 8, ry, w - 16, ROW_H);
    }
    ctx.textAlign = "left";
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = "#9aa8b8";
    ctx.fillText(labelOf[i], x + 14, ry + ROW_H / 2);
  }

  for (const r of rows) {
    hit.push({ action: r.action, x: r.x, y: r.y, w: r.w, h: r.h });
    if (r.swatch) {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, 5);
      else ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = r.swatch;
      ctx.fill();
      if (String(p.fontColor).toLowerCase() === r.swatch.toLowerCase()) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
      continue;
    }
    if (r.toggle) {
      const on = p.fitFill === true;
      rrect(ctx, r.x, r.y, r.w, r.h, 13);
      ctx.fillStyle = on ? "rgba(74,222,128,0.22)" : "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = on ? "rgba(74,222,128,0.55)" : "rgba(255,255,255,0.16)";
      ctx.stroke();
      ctx.font = '13px "Microsoft YaHei", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = on ? "#7ff0a8" : "#9aa8b8";
      ctx.fillText(on ? "已开" : "已关", r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      continue;
    }
    if (r.value) {
      // 只显示当前值的格子
      ctx.font = '13px "Microsoft YaHei", sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#e8eef5";
      ctx.fillText(r.text, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
      continue;
    }
    // 按钮
    rrect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fillStyle = r.action === "close" ? "rgba(255,95,95,0.16)" : "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = r.action === "close" ? "#ffb0b0" : "#e8eef5";
    ctx.fillText(r.text, r.x + r.w / 2, r.y + r.h / 2 + 0.5);
  }

  // 页脚提示
  ctx.textAlign = "left";
  ctx.font = '12px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "#7c8a9c";
  ctx.fillText("双击改内容 · 拖宽折行 · 拖高缩字", x + 14, y + h - FOOT_H / 2 - 2);

  ctx.restore();
  return hit;
}

// ---------------------------------------------------------------------------
// 原生取色器（DOM 层，避开画布）
// ---------------------------------------------------------------------------
function openColorPicker(node, clientX, clientY) {
  const cur = String(ensureProps(node).fontColor || "#ffffff");
  const inp = document.createElement("input");
  inp.type = "color";
  if (/^#[0-9a-fA-F]{6}$/.test(cur)) inp.value = cur;
  inp.style.cssText =
    `position:fixed;left:${Math.round(clientX) - 24}px;top:${Math.round(clientY) - 16}px;` +
    "width:48px;height:32px;z-index:2147483000;border:1px solid #8ab4f8;border-radius:6px;" +
    "background:#111318;box-shadow:0 6px 20px rgba(0,0,0,.6);cursor:pointer";
  document.body.appendChild(inp);
  const apply = () => {
    node.properties.fontColor = inp.value;
    node._lay = layoutFor(node);
    autoHeight(node);
    node.setDirtyCanvas?.(true, true);
  };
  inp.addEventListener("input", apply);
  inp.addEventListener("change", () => {
    apply();
    setTimeout(() => inp.remove(), 200);
  });
  try {
    if (typeof inp.showPicker === "function") inp.showPicker();
    else inp.click();
  } catch (e) {
    try { inp.click(); } catch (e2) {}
  }
  setTimeout(() => { if (document.body.contains(inp)) inp.remove(); }, 90000);
}

// ---------------------------------------------------------------------------
// 连点（点快了会叠加）防抖 + 长按连续
// ---------------------------------------------------------------------------
function applyAction(node, action, clientX, clientY) {
  const p = ensureProps(node);
  if (action === "size-") p.fontSize = clamp(p.fontSize - 2, 8, 600);
  else if (action === "size--") p.fontSize = clamp(p.fontSize - 10, 8, 600);
  else if (action === "size+") p.fontSize = clamp(p.fontSize + 2, 8, 600);
  else if (action === "size++") p.fontSize = clamp(p.fontSize + 10, 8, 600);
  else if (action === "font-prev") p.fontFamily = FONTS[(fontIndexOf(p.fontFamily) + FONTS.length - 1) % FONTS.length][0];
  else if (action === "font-next") p.fontFamily = FONTS[(fontIndexOf(p.fontFamily) + 1) % FONTS.length][0];
  else if (action === "weight-prev") p.fontWeight = WEIGHTS[(weightIndexOf(p.fontWeight) + WEIGHTS.length - 1) % WEIGHTS.length][0];
  else if (action === "weight-next") p.fontWeight = WEIGHTS[(weightIndexOf(p.fontWeight) + 1) % WEIGHTS.length][0];
  else if (action && action.startsWith("color:")) p.fontColor = action.slice(6);
  else if (action === "color-custom") { openColorPicker(node, clientX, clientY); return; }
  else if (action === "fit-toggle") p.fitFill = !(p.fitFill === true);
  else if (action === "close") { node._panelOpen = false; node.setDirtyCanvas?.(true, true); return; }
  else return;
  node._lay = layoutFor(node);
  autoHeight(node);
  node.setDirtyCanvas?.(true, true);
}

// ---------------------------------------------------------------------------
// 画布级事件：悬停 / 点击（都用 LiteGraph 自己的坐标换算，保证准）
// ---------------------------------------------------------------------------
function toGraph(e) {
  const canvas = app.canvas;
  try {
    if (typeof canvas.convertEventToCanvasOffset === "function") {
      const p = canvas.convertEventToCanvasOffset(e);
      if (p && isFinite(p[0])) return p;
    }
  } catch (err) {}
  const el = canvas.canvas;
  const rect = el.getBoundingClientRect();
  const ds = canvas.ds;
  return [(e.clientX - rect.left) / ds.scale - ds.offset[0], (e.clientY - rect.top) / ds.scale - ds.offset[1]];
}

function bigLabels() {
  const g = app.graph;
  if (!g || !g._nodes) return [];
  return g._nodes.filter((n) => n && n.type === "WJZ_BigLabel");
}

// 排查用：把最近若干次指针事件处理结果留一份，便于无头实测取证（不影响功能）
function dbg(o) {
  try {
    const w = typeof window !== "undefined" ? window : null;
    if (!w) return;
    const arr = (w.__wjzBLDbg = w.__wjzBLDbg || []);
    arr.push(o);
    if (arr.length > 60) arr.shift();
  } catch (e) {}
}

function localPoint(node, gp) {
  return [gp[0] - node.pos[0], gp[1] - node.pos[1]];
}

function initHooks() {
  const el = app.canvas && app.canvas.canvas;
  if (!el || el.__wjzBigLabelHook) return;
  el.__wjzBigLabelHook = true;
  try { window.__wjzBLCanvas = el; } catch (e) {}

  // 悬停：鼠标在「文字范围/⚙ 按钮/面板」里就显示黑框，移开就隐藏
  el.addEventListener("pointermove", (e) => {
    let dirty = false;
    const gp = toGraph(e);
    for (const n of bigLabels()) {
      const L = n._lay || (n._lay = layoutFor(n));
      const [lx, ly] = localPoint(n, gp);
      const inside =
        inRect(lx, ly, L.box) || inRect(lx, ly, L.gearRect) || (n._panelOpen === true && inRect(lx, ly, L.panel));
      if (inside !== (n.__wjzHover === true)) {
        n.__wjzHover = inside;
        dirty = true;
      }
    }
    if (dirty) app.canvas.setDirty?.(true, true);
  });

  el.addEventListener("pointerleave", () => {
    let dirty = false;
    for (const n of bigLabels()) {
      if (n.__wjzHover) { n.__wjzHover = false; dirty = true; }
    }
    if (dirty) app.canvas.setDirty?.(true, true);
  });

  // ★pointerdown/dblclick 必须挂在 window 的「捕获阶段」：
  //   本机前端在 canvas 的祖先节点上也有捕获阶段的 pointerdown（触摸/拖拽处理），
  //   它会把事件在到达 canvas 之前截停 —— 挂在 canvas 上的 pointerdown 根本不触发（实测）。
  //   window 是最外层，捕获阶段先于所有祖先跑，再按 target 过滤即可。
  const onDown = (e) => {
    if (e.target !== el && !(el.parentElement && el.parentElement.contains(e.target))) return;
    if (e.button !== 0) { dbg({ ev: "down-skip", button: e.button }); return; }
    const gp = toGraph(e);
    const list = bigLabels();
    dbg({ ev: "down", gp: gp.map(Math.round), n: list.length });
    for (const n of list) {
      const L = n._lay || (n._lay = layoutFor(n));
      const [lx, ly] = localPoint(n, gp);
      dbg({ ev: "down-node", lx: Math.round(lx), ly: Math.round(ly), gear: [L.gearRect.x, L.gearRect.y, L.gearRect.w, L.gearRect.h], inGear: inRect(lx, ly, L.gearRect), open: n._panelOpen === true });
      if (n._panelOpen === true) {
        if (inRect(lx, ly, L.panel)) {
          const hit = n._hit || [];
          for (const r of hit) {
            if (inRect(lx, ly, r)) {
              applyAction(n, r.action, e.clientX, e.clientY);
              return;
            }
          }
          return; // 面板空白处：不穿透
        }
        if (!inRect(lx, ly, L.box)) {
          n._panelOpen = false;
          n.setDirtyCanvas?.(true, true);
        }
      }
      if (inRect(lx, ly, L.gearRect)) {
        n._panelOpen = n._panelOpen !== true;
        n.setDirtyCanvas?.(true, true);
        return;
      }
    }
  };
  window.addEventListener("pointerdown", onDown, true);

  // 双击文字 → 改内容
  const onDbl = (e) => {
    if (e.target !== el && !(el.parentElement && el.parentElement.contains(e.target))) return;
    const gp = toGraph(e);
    for (const n of bigLabels()) {
      const L = n._lay || (n._lay = layoutFor(n));
      const [lx, ly] = localPoint(n, gp);
      if (inRect(lx, ly, L.box)) {
        const v = prompt("大字文本（\\n 换行）：", ensureProps(n).text);
        if (v !== null) {
          n.properties.text = v;
          n._lay = layoutFor(n);
          autoHeight(n);
          n.setDirtyCanvas?.(true, true);
        }
        return;
      }
    }
  };
  window.addEventListener("dblclick", onDbl, true);
}

// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------
app.registerExtension({
  name: "WenjiezxTool.BigLabel",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "WJZ_BigLabel") return;

    // ★标题栏必须在「类」上关掉：实例赋值会撞只读 getter 抛错（见文件头坑 A）
    try {
      const LG = typeof LiteGraph !== "undefined" ? LiteGraph : window.LiteGraph;
      if (LG && typeof LG.NO_TITLE === "number") nodeType.title_mode = LG.NO_TITLE;
    } catch (e) {}

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      ensureProps(this);
      this.title = "";
      this.color = "transparent";
      this.bgcolor = "transparent";
      if (!this.size || !this.size[0]) this.size = [460, 120];
      this._lastW = this.size[0];
      this._lastH = this.size[1];
      this._panelOpen = false;
      this.__wjzHover = false;
      this._lay = layoutFor(this);
      autoHeight(this);
      this._lastW = this.size[0];
      this._lastH = this.size[1];
      initHooks();
      this.setDirtyCanvas?.(true, true);
      return r;
    };

    // 背景全透明：画布上只有大字本身（标题栏已由 title_mode 关掉）
    nodeType.prototype.onDrawBackground = function () {};

    // 装载工作流后：透明底色/标题要再压一次（存档里的 color/bgcolor/title 会盖回来）
    nodeType.prototype.onConfigure = function () {
      this.__wjzLoading = true;
      this.title = "";
      this.color = "transparent";
      this.bgcolor = "transparent";
      this._lastW = this.size ? this.size[0] : this._lastW;
      this._lastH = this.size ? this.size[1] : this._lastH;
      this._panelOpen = false;
      this._lay = layoutFor(this);
      setTimeout(() => {
        this.__wjzLoading = false;
        this._lastW = this.size ? this.size[0] : this._lastW;
        this._lastH = this.size ? this.size[1] : this._lastH;
        this._lay = layoutFor(this);
        autoHeight(this);
        this._lastH = this.size ? this.size[1] : this._lastH;
        this.setDirtyCanvas?.(true, true);
      }, 0);
    };

    // 拖右下角：★谁的变化大听谁的那条轴——
    //   横向拖 → 文字按新宽度重新折行，框高随行数自动加高（Figma「自动高度」）；
    //   纵向拖 → 字号随高度等比缩放（旧有 Scale 行为）；
    //   斜着拖 → 看每次事件里 dw/dh 哪个大（以增量比较，用户基本只往一个方向用力）。
    nodeType.prototype.onResize = function (size) {
      if (this.__wjzLoading) {
        if (size) {
          if (size[0]) this._lastW = size[0];
          if (size[1]) this._lastH = size[1];
        }
        return;
      }
      if (!size || !size[0] || !size[1]) return;
      const dw = size[0] - (this._lastW || size[0]);
      const dh = size[1] - (this._lastH || size[1]);
      if (Math.abs(dw) < 0.5 && Math.abs(dh) < 0.5) {
        this._lastW = size[0];
        this._lastH = size[1];
        return;
      }
      if (Math.abs(dw) >= Math.abs(dh)) {
        // 宽度主导：换折行宽度重排；fitFill 关时框高/节点高随内容走
        this._lay = layoutFor(this);
      } else if (this._lastH) {
        // 高度主导：字号等比缩放
        const scale = size[1] / this._lastH;
        this.properties.fontSize = clamp(Math.round(this.properties.fontSize * scale), 8, 600);
        this._lay = layoutFor(this);
      }
      autoHeight(this);
      this._lastW = this.size[0];
      this._lastH = this.size[1];
      this.setDirtyCanvas?.(true, true);
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      if (this.flags && this.flags.collapsed) return;
      ensureProps(this);
      const L = (this._lay = layoutFor(this));
      const show = this.__wjzHover === true || this._panelOpen === true;

      // 黑色背景框：只在鼠标停在文字/按钮范围内时出现，完整包裹整段文字
      if (show) {
        ctx.save();
        // 投影 + 近不透明黑底 + 亮边，保证在深色画布上也清晰可辨（与用户原图一致）
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 4;
        rrect(ctx, L.box.x, L.box.y, L.box.w, L.box.h, 12);
        ctx.fillStyle = "rgba(8,8,10,0.96)";
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.30)";
        ctx.stroke();
        ctx.restore();
      }

      // 大字本体
      ctx.save();
      ctx.font = `${L.weight} ${L.fontSize}px ${L.family}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = L.color;
      let y = L.textY;
      for (const ln of L.lines) {
        ctx.fillText(ln, L.textX, y);
        y += L.lineH;
      }
      ctx.restore();

      // ⚙ 设置按钮（尺寸跟随字号；面板开着时高亮）
      if (show) {
        const g = L.gearRect;
        ctx.save();
        rrect(ctx, g.x, g.y, g.w, g.h, 7);
        ctx.fillStyle = this._panelOpen === true ? "rgba(214,254,81,0.22)" : "rgba(255,255,255,0.12)";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.stroke();
        drawGear(ctx, g.x + g.w / 2, g.y + g.h / 2, Math.max(6, g.w * 0.3), "#eaf7b4", "rgba(0,0,0,0.88)");
        ctx.restore();
      }

      if (this._panelOpen === true) {
        this._hit = drawPanel(ctx, L, this);
      } else {
        this._hit = [];
      }
    };
  },
});
