import { app } from "../../scripts/app.js";

const PLACEHOLDER = "（不选·自动占位）";

// 根据三合一节点的模式，联动设置所有「可选图像加载器」：
// 文生图 -> 自动占位（不用放图）；图片编辑 -> 保持/放行用户选择的图片
function syncLoaders(modeWidget) {
  if (!app.graph) return;
  const isT2I = String(modeWidget?.value ?? "").includes("文生图");
  for (const node of app.graph._nodes) {
    if (!node || node.type !== "WJZ_ImageLoaderOptional") continue;
    const w = node.widgets?.find((x) => x.name === "图片文件" || x.name === "image");
    if (!w) continue;
    if (isT2I && String(w.value ?? "").trim() !== PLACEHOLDER) {
      w.value = PLACEHOLDER;
      node.setDirtyCanvas(true, true);
    }
  }
}

app.registerExtension({
  name: "wenjiezxTool.ModeLink",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name === "WJZ_ModeLatentCanvas") {
      const onCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = onCreated?.apply(this, arguments);
        const mw = this.widgets?.find((w) => w.name === "模式");
        if (mw) {
          const prev = mw.callback;
          mw.callback = function (...args) {
            prev?.apply(this, args);
            syncLoaders(mw);
          };
          // 加载工作流/拖入节点后，先同步一次
          setTimeout(() => syncLoaders(mw), 80);
        }
        return r;
      };
    }
  },
});
