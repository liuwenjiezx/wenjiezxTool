import { app } from "../../scripts/app.js";

const ROUTER_MAX = 16;
const PLACEHOLDER = "（不选·自动占位）";

// =====================================================================
// 图片批量导入器：DOM 缩略图管理器（拖入/点导入/拖动排序/删除）
// 后端参数「图片列表」存 JSON 数组字符串，前端 DOM widget 同名接管
// =====================================================================
app.registerExtension({
  name: "wenjiezxTool.ImageBatchImporter",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "WJZ_ImageBatchImporter") return;

    const onCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onCreated?.apply(this, arguments);
      const node = this;

      // 移除后端默认文本 widget，改用同名 DOM widget 接管
      const wi = node.widgets.findIndex((w) => w.name === "图片列表");
      if (wi >= 0) node.widgets.splice(wi, 1);

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
      btn.style.cssText =
        "flex:1;cursor:pointer;padding:3px 8px;font-size:12px;";
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

      // 缩略图网格
      const grid = document.createElement("div");
      grid.style.cssText =
        "display:flex;flex-wrap:wrap;gap:4px;max-height:260px;overflow:auto;";
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
            "position:relative;width:64px;height:64px;border:1px solid #555;border-radius:4px;overflow:hidden;cursor:grab;background:#1a1a1a;flex:0 0 auto;";
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
            "position:absolute;top:1px;right:1px;width:15px;height:15px;line-height:13px;text-align:center;background:rgba(0,0,0,.75);color:#fff;border-radius:50%;cursor:pointer;font-size:11px;";
          del.onclick = (ev) => {
            ev.stopPropagation();
            files.splice(i, 1);
            render();
            commit();
          };
          const tag = document.createElement("span");
          tag.textContent = String(i + 1);
          tag.style.cssText =
            "position:absolute;left:1px;bottom:1px;width:15px;height:15px;line-height:15px;text-align:center;background:rgba(0,0,0,.75);color:#fff;border-radius:50%;font-size:10px;";
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
        const w = node.widgets.find((x) => x.name === "图片列表");
        if (w) w.callback?.(w.value);
        node.setDirtyCanvas(true, true);
      }

      // 用内核自带的 addDOMWidget 创建 DOM 组件（新版前端原生支持）
      const dw = node.addDOMWidget("图片列表", "wjzimglist", div, {
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
        getMinHeight: () => 320,
        getMaxHeight: () => 640,
      });
      // 初次创建/加载后恢复已保存列表
      if (dw && dw.value) {
        try {
          const arr = JSON.parse(dw.value || "[]");
          files.length = 0;
          if (Array.isArray(arr)) files.push(...arr);
          render();
        } catch (err) {}
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
