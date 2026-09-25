import { app } from "../../scripts/app.js";

const ROUTER_MAX = 16;
const PROMPT_ROWS = 5; // 提示词框一次可见行数（用户要求 5 行）

// =====================================================================
// 清理：后端参数「图片列表」的原始输入框
// 它是插件内部数据（已导入图片文件名的 JSON 列表），由下方图片区自动维护，
// 用户不需要手填任何东西 —— 所以界面上不要出现这个框。
// 注意：仅从 node.widgets 里 splice 掉不够，新版前端的 DOM 输入框会留在页面上
//     （表现为节点顶部一个空的 [] 黑框），必须连 element 一起 remove，
//     并在节点生命周期的多个时机反复兜底。
// =====================================================================
function dropNativeListWidget(node) {
  if (!node || !Array.isArray(node.widgets)) return false;
  node.__wjzDropTries = node.__wjzDropTries || 0;
  if (node.__wjzDropTries > 500) return false; // 极端保护：避免被反复重建时陷入死循环
  let removed = false;
  for (let guard = 0; guard < 8; guard++) {
    const i = node.widgets.findIndex(
      (w) => w && w.name === "图片列表" && !w.__wjzImporter
    );
    if (i < 0) break;
    const w = node.widgets[i];
    [w.element, w.inputEl, w.el, w.domElement, w.textarea].forEach((el) => {
      try {
        if (el && el.remove) el.remove();
      } catch (e) {}
    });
    try {
      w.element = null;
    } catch (e) {}
    try {
      w.inputEl = null;
    } catch (e) {}
    node.widgets.splice(i, 1);
    removed = true;
  }
  if (removed) {
    node.__wjzDropTries += 1;
    try {
      node.setDirtyCanvas(true, true);
    } catch (e) {}
  }
  return removed;
}

// =====================================================================
// 共用：图片输入区（DOM 缩略图管理器：拖入/点导入/拖动排序/删除）
// 后端参数「图片列表」存 JSON 数组字符串，前端 DOM widget 同名接管
// =====================================================================
function createImporterUI(node, widgetName) {
  const files = [];

  const div = document.createElement("div");
  div.className = "wjz-importer";
  div.style.cssText =
    "width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:4px;padding:4px;";

  // 顶部：导入按钮 + 提示
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:6px;align-items:center;";
  const btn = document.createElement("button");
  btn.textContent = "＋ 导入图片";
  btn.style.cssText = "flex:1;cursor:pointer;padding:3px 8px;font-size:12px;";
  const hint = document.createElement("span");
  hint.textContent = "或拖图到下方";
  hint.style.cssText = "font-size:10px;color:#888;white-space:nowrap;";
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = "image/*";
  input.style.display = "none";
  btn.onclick = () => input.click();
  input.onchange = () => {
    uploadFiles(input.files);
    input.value = "";
  };
  bar.appendChild(btn);
  bar.appendChild(hint);
  bar.appendChild(input);
  div.appendChild(bar);

  // 图片用途说明（一眼看懂第1张和其余图片的关系；文案随模式变化，见 __wjzSetImporterNote）
  const note = document.createElement("div");
  note.textContent = "第 1 张 = 要改的图，其余 = 素材图";
  note.style.cssText = "font-size:10px;color:#b0b0b0;line-height:1.4;";
  div.appendChild(note);

  // 缩略图网格（100px 一格，节点宽度内一行放 4 张；带圆角更好认）
  const THUMB = 100;
  const grid = document.createElement("div");
  grid.style.cssText =
    "display:flex;flex-wrap:wrap;gap:4px;max-height:324px;overflow:auto;";
  div.appendChild(grid);

  // 整个面板支持拖入图片文件
  div.addEventListener("dragover", (e) => e.preventDefault());
  div.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  async function uploadFiles(fileList) {
    for (const f of fileList) {
      if (!f.type.startsWith("image/")) continue;
      const fd = new FormData();
      fd.append("image", f);
      fd.append("overwrite", "false");
      try {
        const resp = await app.api.fetchApi("/upload/image", {
          method: "POST",
          body: fd,
        });
        const j = await resp.json();
        if (j && j.name) files.push(j.name);
      } catch (err) {
        console.warn("wjz importer upload", err);
      }
    }
    render();
    commit();
  }

  function thumbUrl(name) {
    const params = new URLSearchParams({ filename: name, type: "input", subfolder: "" });
    return "/view?" + params.toString();
  }

  function render() {
    grid.innerHTML = "";
    files.forEach((name, i) => {
      const box = document.createElement("div");
      box.draggable = true;
      box.style.cssText =
        "position:relative;width:" + THUMB + "px;height:" + THUMB + "px;border:1px solid #555;border-radius:6px;overflow:hidden;cursor:grab;background:#1a1a1a;flex:0 0 auto;";
      const img = document.createElement("img");
      img.src = thumbUrl(name);
      img.onerror = () => {
        img.remove();
        const sp = document.createElement("span");
        sp.textContent = name.split("/").pop();
        sp.style.cssText = "font-size:9px;color:#aaa;word-break:break-all;padding:3px;line-height:1.3;";
        box.appendChild(sp);
      };
      img.style.cssText =
        "width:100%;height:100%;object-fit:cover;pointer-events:none;display:block;";
      const del = document.createElement("span");
      del.textContent = "×";
      del.style.cssText =
        "position:absolute;top:2px;right:2px;width:19px;height:19px;line-height:17px;text-align:center;background:rgba(0,0,0,.75);color:#fff;border-radius:50%;cursor:pointer;font-size:14px;";
      del.onclick = (ev) => {
        ev.stopPropagation();
        files.splice(i, 1);
        render();
        commit();
      };
      const tag = document.createElement("span");
      tag.textContent = String(i + 1);
      tag.style.cssText =
        "position:absolute;left:2px;bottom:2px;width:18px;height:18px;line-height:18px;text-align:center;background:rgba(0,0,0,.75);color:#fff;border-radius:50%;font-size:12px;";
      box.appendChild(img);
      box.appendChild(del);
      box.appendChild(tag);

      box.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/wjz-idx", String(i));
        box.style.opacity = ".35";
      });
      box.addEventListener("dragend", () => {
        box.style.opacity = "1";
      });
      box.addEventListener("dragover", (e) => e.preventDefault());
      box.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const from = Number(e.dataTransfer.getData("text/wjz-idx"));
        if (Number.isFinite(from) && from !== i) {
          const [mv] = files.splice(from, 1);
          files.splice(i, 0, mv);
          render();
          commit();
        }
      });
      grid.appendChild(box);
    });
  }

  function commit() {
    const w = node.widgets.find((x) => x.name === widgetName && x.__wjzImporter);
    if (w) {
      // 双保险：既写 value（供保存工作流/提交），也触发 callback
      try {
        w.value = JSON.stringify(files);
      } catch (err) {}
      try {
        w.callback?.(w.value);
      } catch (err) {}
    }
    node.setDirtyCanvas(true, true);
  }

  // 用内核自带的 addDOMWidget 创建 DOM 组件（新版前端原生支持）
  const dw = node.addDOMWidget(widgetName, "wjzimglist", div, {
    getValue() {
      return JSON.stringify(files);
    },
    setValue(v) {
      try {
        const arr = JSON.parse(v || "[]");
        files.length = 0;
        if (Array.isArray(arr)) files.push(...arr);
      } catch (err) {
        files.length = 0;
      }
      render();
    },
    getMinHeight: () => 200,
    getMaxHeight: () => 640,
  });
  // 打标记：清理原生「图片列表」框时靠它区分，避免误删本 UI
  try {
    dw.__wjzImporter = true;
  } catch (e) {}
  // 初次创建/加载后恢复已保存列表
  if (dw && dw.value) {
    try {
      const arr = JSON.parse(dw.value || "[]");
      files.length = 0;
      if (Array.isArray(arr)) files.push(...arr);
      render();
    } catch (err) {}
  }
  // 供外部（模式切换时）改图片区上方那行说明文字
  node.__wjzSetImporterNote = (text) => {
    try {
      note.textContent = text;
    } catch (e) {}
  };
}

// =====================================================================
// 图片批量导入器 与 文生图/编辑三合一：底部挂图片输入区
// =====================================================================
app.registerExtension({
  name: "wenjiezxTool.ImageImporterUI",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "WJZ_ImageBatchImporter" && nodeData.name !== "WJZ_ModeLatentCanvas") return;

    // 兜底 1：每帧绘制时检查一次，原生「图片列表」框一旦冒出来立刻清掉（不存在时开销可忽略）；
    //        顺带盯住「模式」的值变化（加载工作流 / 切换模式），实时刷新提示词说明条
    const onFore = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      const r = onFore?.apply(this, arguments);
      dropNativeListWidget(this);
      if (typeof this.__wjzSyncLbl === "function") {
        try {
          const mw = (this.widgets || []).find((w) => w && w.name === "模式");
          const mv = String((mw && mw.value) ?? "");
          if (mv !== this.__wjzLastMode) {
            this.__wjzLastMode = mv;
            this.__wjzSyncLbl();
          }
        } catch (e) {}
      }
      return r;
    };

    // 兜底 2：加载工作流 / 配置节点后再清一次
    const onConf = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConf?.apply(this, arguments);
      const node = this;
      dropNativeListWidget(node);
      if (typeof node.__wjzSyncLbl === "function") {
        try {
          node.__wjzSyncLbl();
        } catch (e) {}
      }
      [80, 300, 800].forEach((t) =>
        setTimeout(() => {
          dropNativeListWidget(node);
          node.__wjzFitPrompt?.(); // 加载工作流后前端会把 textarea 行数改回去，补一遍
          node.__wjzSyncRatio?.(); // 「画面比例」下拉也要按当前模式重刷一遍
          try {
            const want = node.computeSize()[1];
            if ((node.size[1] || 0) < want) node.setSize([node.size[0], want]);
          } catch (e) {}
        }, t)
      );
      return r;
    };

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;

      // 先移除后端默认文本 widget（连它的 DOM 输入框一起），改用同名 DOM widget 接管
      dropNativeListWidget(node);

      createImporterUI(node, "图片列表");

      // 新版前端有时会在稍后重建这个框，多个时机反复清
      [60, 200, 500, 1200].forEach((t) =>
        setTimeout(() => dropNativeListWidget(node), t)
      );

      // 三合一节点：加宽保证右侧输出口标签完整显示；提示词框默认收起成一行并在上方标注作用；输出口加中文说明
      if (nodeData.name === "WJZ_ModeLatentCanvas") {
        const pw = node.widgets.find((w) => w.name === "提示词");
        if (pw) {
          try {
            // 新版前端 widget 的 label 不渲染，用 DOM 说明条插在提示词框上方，注明输入什么
            const lbl = document.createElement("div");
            lbl.style.cssText =
              "width:100%;box-sizing:border-box;padding:3px 6px;font-size:11px;line-height:1.5;color:#ffd966;background:rgba(255,217,102,.08);border-top:1px solid #3a3a3a;";
            // 说明文案随「模式」实时变化，明确告诉用户这是唯一要打字的地方
            const modeW = node.widgets.find((w) => w.name === "模式");
            const syncLbl = () => {
              const isEdit = String(modeW?.value ?? "").indexOf("编辑") >= 0;
              lbl.textContent = isEdit
                ? "▼ 提示词：写「要怎么改」，可用 <image1> 指代参考图"
                : "▼ 提示词：写「画面里有什么」（此模式不用放图）";
              node.__wjzSetImporterNote?.(
                isEdit
                  ? "第 1 张 = 要改的图，其余 = 素材图 ｜ 想跟原图同比例，画面比例选「参考图1比例」"
                  : "此模式不用放图，直接在上面写画面描述即可"
              );
              node.__wjzSyncRatio?.(isEdit); // 「画面比例」下拉随模式增删「参考图1比例」
            };
            syncLbl();
            node.__wjzSyncLbl = syncLbl; // 供 onDrawForeground / onConfigure 在模式变化时刷新
            node.__wjzLastMode = String(modeW?.value ?? "");

            // ---- 「画面比例」下拉：文生图模式下摘掉「参考图1比例」 ----
            // 后端为了让工作流里存的值始终合法，把这一项常驻在 INPUT_TYPES 的列表里，
            // 但文生图没有参考图，露出来只会让人困惑 —— 所以在文生图模式下把它藏掉。
            // 新版前端渲染下拉就是读 widget.options.values（core 里的 _resolveComboValues
            // 同样直接给它赋值），改完 setDirtyCanvas 即可生效，不需要重建 widget。
            //
            // 值怎么处理（两个状态变量）：
            //   __wjzEditRatio —— 编辑模式下选的比例（记忆，切回来时还原）
            //   __wjzRatioAuto  —— 当前值是不是被本函数自动换掉的（不是用户选的）
            // 典型场景：「参考图1比例」在文生图里不存在，切过去时程序把它换成 16:9，
            // 切回编辑模式要还回来；但用户若在文生图里自己选过别的比例，就以用户为准。
            const ratioW = node.widgets.find((w) => w && w.name === "画面比例");
            if (ratioW && Array.isArray(ratioW.options?.values)) {
              const ALL = ratioW.options.values.slice(); // 后端给的完整列表
              const REF = ALL.find((v) => String(v).indexOf("参考图1") >= 0) || null;
              const DEF = ALL.find((v) => String(v).indexOf("16:9") >= 0) || ALL[0];
              const isEditNow = () =>
                String(modeW?.value ?? "").indexOf("编辑") >= 0;

              // 改值：__wjzRatioSetting 是哨兵，让 callback 包装知道"这是程序改的"，
              // 以免把 __wjzEditRatio 当成用户选择、进而误判
              const put = (v, auto) => {
                node.__wjzRatioSetting = true;
                ratioW.value = v;
                try {
                  ratioW.callback?.(v);
                } finally {
                  node.__wjzRatioSetting = false;
                }
                node.__wjzRatioAuto = auto;
              };

              const syncRatio = (isEdit) => {
                if (isEdit === undefined) isEdit = isEditNow();
                const want = isEdit || !REF ? ALL.slice() : ALL.filter((v) => v !== REF);
                const cur = ratioW.options.values;
                const same =
                  Array.isArray(cur) &&
                  cur.length === want.length &&
                  cur.every((v, i) => v === want[i]);
                if (!same) ratioW.options.values = want;

                const valid = want.indexOf(ratioW.value) >= 0;
                // 刚切进编辑模式、且用户没在编辑模式里亲手选过比例 → 默认「参考图1比例」
                // （出图跟第 1 张参考图同比例，是编辑时最常用的意图）
                const switchDefault =
                  isEdit && node.__wjzSwitchedToEdit && REF &&
                  !node.__wjzEditRatioUser &&
                  want.indexOf(REF) >= 0 && ratioW.value !== REF;
                if (!valid) {
                  // 当前值在这个模式下不存在，必须换一个：
                  // 编辑模式优先还给用户上次选的那个（通常是「参考图1比例」），否则回编辑默认
                  const kept = node.__wjzEditRatio;
                  put(
                    isEdit && kept && want.indexOf(kept) >= 0 ? kept : (isEdit && REF ? REF : DEF),
                    true
                  );
                } else if (switchDefault) {
                  put(REF, true);
                } else if (
                  isEdit &&
                  node.__wjzRatioAuto &&
                  node.__wjzEditRatio &&
                  want.indexOf(node.__wjzEditRatio) >= 0 &&
                  ratioW.value !== node.__wjzEditRatio
                ) {
                  // 回到编辑模式，当前值虽然合法，但它是刚才被程序从「参考图1比例」换掉的
                  // —— 还回去。用户若在这期间自己手动选过，__wjzRatioAuto 已被 callback
                  //    清掉，不会走到这里，所以不会覆盖用户的选择。
                  put(node.__wjzEditRatio, false);
                } else {
                  node.__wjzRatioAuto = false;
                }
                node.__wjzSwitchedToEdit = false; // 默认值逻辑只在新切进编辑时生效一次
                if (isEdit) node.__wjzEditRatio = ratioW.value;
                node.__wjzWasEdit = isEdit; // 记住当前在哪个模式，供下次切模式时判断"从哪切来"
                if (!same) node.setDirtyCanvas?.(true, true);
              };
              node.__wjzSyncRatio = syncRatio;
              node.__wjzWasEdit = isEditNow();
              node.__wjzSwitchedToEdit = false;
              if (isEditNow()) node.__wjzEditRatio = ratioW.value;
              syncRatio();
              const rcb = ratioW.callback;
              ratioW.callback = function (...a) {
                const rr = rcb?.apply(this, a);
                if (!node.__wjzRatioSetting) {
                  node.__wjzRatioAuto = false; // 用户自己选的
                  if (isEditNow()) {
                    node.__wjzEditRatio = ratioW.value;
                    node.__wjzEditRatioUser = true; // 用户在编辑模式亲手选过，之后切模式不再替他默认
                  }
                }
                return rr;
              };
            }

            if (modeW) {
              const mcb = modeW.callback;
              modeW.callback = function (...a) {
                const wasEdit = !!node.__wjzWasEdit; // callback 触发时值已更新，"从哪切来"靠记忆
                const rr = mcb?.apply(this, a);
                const nowEdit = String(modeW?.value ?? "").indexOf("编辑") >= 0;
                node.__wjzSwitchedToEdit = !wasEdit && nowEdit; // 刚从文生图切进编辑 → 默认参考图1比例
                setTimeout(syncLbl, 0);
                return rr;
              };
            }
            const dwl = node.addDOMWidget("提示词说明", "wjzpromptbar", lbl, {
              getValue: () => "",
              setValue: () => {},
              getMinHeight: () => 22,
              getMaxHeight: () => 22,
            });
            dwl.serialize = false;
            const dwIdx = node.widgets.indexOf(dwl);
            if (dwIdx > -1) node.widgets.splice(dwIdx, 1);
            const pwIdx = node.widgets.indexOf(pw);
            if (pwIdx > -1) node.widgets.splice(pwIdx, 0, dwl);
            // 提示词框：一次看到 5 行（height 在新版前端是只读 getter，用 textarea 的行数控制）
            const fitPrompt = () => {
              const ta = pw.inputEl || pw.el;
              if (!ta || ta.tagName !== "TEXTAREA") return false;
              if (ta.rows !== PROMPT_ROWS) ta.rows = PROMPT_ROWS;
              ta.style.height = "auto";
              ta.style.minHeight = PROMPT_ROWS * 21 + "px";
              return true;
            };
            node.__wjzFitPrompt = fitPrompt;
            // 改完行数要让节点跟着长高，否则框会压到下面的图片区
            const growNode = () => {
              try {
                fitPrompt();
                const want = node.computeSize()[1];
                if ((node.size[1] || 0) < want) {
                  node.setSize([node.size[0], want]);
                } else {
                  node.setDirtyCanvas(true, true);
                }
              } catch (e) {}
            };
            // 前端建 DOM / 重排的时机不止一次，隔几个时间点各补一遍
            [0, 60, 250, 600, 1200].forEach((t) => setTimeout(growNode, t));
          } catch (e) { /* 标注失败不影响使用 */ }
        }
        try {
          // 输出口中文说明（鼠标悬停端口可看）：这些是自动计算的结果，不用填
          const tips = {
            "宽度": "本次出图宽度（像素），由画面比例 × 图片大小自动计算",
            "高度": "本次出图高度（像素），由画面比例 × 图片大小自动计算",
            "图像Latent": "出图画布，自动送给采样器；尺寸 = 画面比例 × 图片大小",
            "编辑分辨率": "图片编辑时的参考图编码精度（跟「图片大小」走，文生图模式不影响）",
            "图片批量": "图片区里的全部图片，按顺序送给「模式图片开关」",
            "图片编辑": "是否为图片编辑模式（布尔值），送给「模式图片开关」",
          };
          node.outputs.forEach((o) => {
            if (tips[o.name]) o.tooltip = tips[o.name];
          });
          // 「画面比例」是原生下拉，鼠标悬停也给一句说明
          const rw = node.widgets.find((w) => w && w.name === "画面比例");
          if (rw) {
            rw.tooltip =
              "决定出图长宽比。选「参考图1比例」= 跟图片区第 1 张图同比例（仅图片编辑模式有这一项）";
          }
          // 「图片大小」同样给悬停说明：写的是 1:1 基准，实际按画面比例缩放
          const sw = node.widgets.find((w) => w && w.name === "图片大小");
          if (sw) {
            sw.tooltip =
              "出图像素基准（1:1 时的边长）。实际尺寸按「画面比例」等比缩放，总像素量不变，如 1024 + 16:9 ≈ 1344×768";
          }
          // 节点默认加宽，右侧端口标签不被挤压
          if (node.size[0] < 360) {
            node.size[0] = 360;
            node.setSize([360, node.size[1] || node.computeSize()[1]]);
          }
        } catch (e3) { /* 忽略 */ }
        setTimeout(() => {
          try {
            node.__wjzFitPrompt?.();
            node.setSize([node.size[0], node.computeSize()[1]]);
            node.setDirtyCanvas(true, true);
          } catch (e2) { /* 忽略 */ }
        }, 80);
      }
      return r;
    };
  },
});

// =====================================================================
// 图片批量路由：输出口数量可加减（按钮），与「输出路数」widget 联动
// =====================================================================
app.registerExtension({
  name: "wenjiezxTool.ImageBatchRouter",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "WJZ_ImageBatchRouter") return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;
      const nw = node.widgets.find((w) => w.name === "输出路数");
      if (!nw) return r;

      function syncOuts(n) {
        n = Math.max(1, Math.min(ROUTER_MAX, Math.floor(Number(n) || 1)));
        while (node.outputs.length > n) node.outputs.pop();
        while (node.outputs.length < n)
          node.addOutput("第" + (node.outputs.length + 1) + "张", "IMAGE");
        node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas(true, true);
      }

      const addB = node.addWidget(
        "button",
        "＋ 加一路",
        null,
        () => {
          nw.value = Math.min(ROUTER_MAX, (Number(nw.value) || 1) + 1);
          syncOuts(nw.value);
        }
      );
      const delB = node.addWidget(
        "button",
        "－ 减一路",
        null,
        () => {
          nw.value = Math.max(1, (Number(nw.value) || 1) - 1);
          syncOuts(nw.value);
        }
      );
      addB.serialize = false;
      delB.serialize = false;

      const prevCb = nw.callback;
      nw.callback = function (...args) {
        prevCb?.apply(this, args);
        syncOuts(nw.value);
      };

      // 加载工作流/新建节点后，按当前值裁剪输出口
      setTimeout(() => syncOuts(nw.value), 60);
      return r;
    };
  },
});
