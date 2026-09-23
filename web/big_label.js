// wenjiezxTool · 画布大字标注节点（WJZ_BigLabel）
// 纯前端显示节点，不参与图执行（替代 rgthree 的 Label，自研实现，无第三方依赖）
//
// 交互设计（用户最终版）：
//   画布上只有大字本身（默认黄色），无背景框、无标题、无齿轮、无 frontend_only 徽标；
//   双击文字 → 展开设置面板（文字/字号/颜色，点行右侧 ✎ 修改），面板右下角 ✕ 收起；
//   拖拽节点右下角把手 → 文字大小随节点高度缩放（拖拉调字号）。
import { app } from "../../../scripts/app.js";

app.registerExtension({
  name: "WenjiezxTool.BigLabel",
  registerCustomNodes() {
    class WJZBigLabel extends LiteGraph.LGraphNode {
      constructor() {
        super();
        this.properties = {
          text: "双击修改文字",
          fontSize: 60,
          fontFamily: "Arial",
          fontColor: "#d6fe51",
        };
        this.title = "";
        this.size = [460, 120];
        this.flags = this.flags || {};
        this.flags.allow_interaction = true;
        // 去掉背景框：背景与边框全透明、标题隐藏、不显示 frontend_only 徽标
        this.bgcolor = "rgba(0,0,0,0)";
        this.color = "rgba(0,0,0,0)";
        this.title_mode = LiteGraph.TITLE_DRAW_HIDDEN;
        this._editMode = false;
        this._lastH = this.size[1];
        this._textBox = null;
        this._editRows = [];
        this._closeBtn = null;
      }

      // 兼容旧版工作流：widgets_values=[文本,字号,颜色] -> properties
      onConfigure(info) {
        if (info && info.widgets_values && Array.isArray(info.widgets_values) && info.widgets_values.length >= 3) {
          if (info.widgets_values[0]) this.properties.text = String(info.widgets_values[0]);
          if (typeof info.widgets_values[1] === "number" && info.widgets_values[1] > 0) this.properties.fontSize = info.widgets_values[1];
          if (info.widgets_values[2]) this.properties.fontColor = String(info.widgets_values[2]);
        }
        if (info && info.properties) {
          for (const k of Object.keys(this.properties)) {
            if (k in info.properties) this.properties[k] = info.properties[k];
          }
        }
        this._lastH = this.size ? this.size[1] : 120;
      }

      // 拖拽右下角把手 → 字号随节点高度缩放
      onResize(size) {
        if (size && size[1] && this._lastH && size[1] !== this._lastH && size[1] > 0) {
          const scale = size[1] / this._lastH;
          this.properties.fontSize = Math.max(10, Math.min(400, Math.round(this.properties.fontSize * scale)));
        }
        if (size && size[1]) this._lastH = size[1];
      }

      // 覆盖默认背景绘制：什么都不画（背景框彻底消失）
      onDrawBackground() {}

      onDrawForeground(ctx) {
        if (this.flags.collapsed) return;
        const fontSize = Math.max(10, this.properties.fontSize || 50);
        const lines = String(this.properties.text || "").split("\n");
        const top = 12, left = 10;
        const lineH = fontSize * 1.15;
        ctx.save();
        ctx.font = `${fontSize}px ${this.properties.fontFamily || "Arial"}`;
        ctx.fillStyle = this.properties.fontColor || "#d6fe51";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        let y = top;
        let maxW = 1;
        for (const ln of lines) {
          ctx.fillText(ln, left, y);
          maxW = Math.max(maxW, ctx.measureText(ln).width);
          y += lineH;
        }
        this._textBox = { x: left, y: top, w: maxW, h: lines.length * lineH };
        ctx.restore();

        if (this._editMode) this._drawEditPanel(ctx);
      }

      _drawEditPanel(ctx) {
        const panelH = 168;
        const needH = 20 + panelH;
        if (this.size[1] < needH) this.size[1] = needH;
        const x = 12, y = this.size[1] - panelH + 8, w = this.size[0] - 24;
        ctx.save();
        ctx.fillStyle = "rgba(22,24,34,0.94)";
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, panelH - 14, 6);
        else ctx.rect(x, y, w, panelH - 14);
        ctx.fill();
        ctx.stroke();
        ctx.font = "12px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        const rows = [
          { key: "text", label: "文字", value: this.properties.text },
          { key: "fontSize", label: "字号", value: this.properties.fontSize },
          { key: "fontColor", label: "颜色", value: this.properties.fontColor },
        ];
        this._editRows = [];
        let ry = y + 14;
        for (const r of rows) {
          ctx.fillStyle = "#9aa8b8";
          ctx.fillText(r.label, x + 16, ry);
          ctx.fillStyle = "#ffffff";
          const vStr = String(r.value);
          ctx.fillText(vStr.length > 22 ? vStr.slice(0, 22) + "…" : vStr, x + 78, ry);
          ctx.fillStyle = "#d6fe51";
          ctx.fillText("✎", x + w - 28, ry);
          this._editRows.push({ key: r.key, box: { x, y: ry - 3, w, h: 24 } });
          ry += 30;
        }
        // 收起按钮
        const bx = x + w - 64, by = ry + 2, bw = 52, bh = 22;
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 4);
        else ctx.rect(bx, by, bw, bh);
        ctx.fill();
        ctx.fillStyle = "#d6fe51";
        ctx.textAlign = "center";
        ctx.fillText("✕ 收起", bx + bw / 2, by + 4);
        ctx.textAlign = "left";
        this._closeBtn = { x: bx, y: by, w: bw, h: bh };
        ctx.restore();
      }

      // 双击文字 → 展开设置
      onDblClick(e, pos) {
        if (this.flags.collapsed) return false;
        if (this._editMode) return false;
        if (this._textBox) {
          const bx = this._textBox;
          if (pos[0] >= bx.x && pos[0] <= bx.x + bx.w && pos[1] >= bx.y && pos[1] <= bx.y + bx.h) {
            this._editMode = true;
            if (this.size[1] < 196) this.size[1] = 196;
            this.setDirtyCanvas(true, true);
            return true;
          }
        }
        return false;
      }

      onMouseDown(e, pos) {
        if (this.flags.collapsed) return false;
        if (this._editMode) {
          // 行修改
          for (const r of this._editRows || []) {
            const b = r.box;
            if (pos[0] >= b.x && pos[0] <= b.x + b.w && pos[1] >= b.y && pos[1] <= b.y + b.h) {
              if (r.key === "text") {
                const v = prompt("大字文本（\\n 换行）：", this.properties.text);
                if (v !== null) this.properties.text = v;
              } else if (r.key === "fontSize") {
                const n = parseInt(prompt("字号（10-400）：", this.properties.fontSize), 10);
                if (!isNaN(n)) this.properties.fontSize = Math.max(10, Math.min(400, n));
              } else if (r.key === "fontColor") {
                const v = prompt("颜色（如 #d6fe51）：", this.properties.fontColor);
                if (v) this.properties.fontColor = v;
              }
              this.setDirtyCanvas(true, true);
              return true;
            }
          }
          // 收起按钮
          if (this._closeBtn) {
            const c = this._closeBtn;
            if (pos[0] >= c.x && pos[0] <= c.x + c.w && pos[1] >= c.y && pos[1] <= c.y + c.h) {
              this._editMode = false;
              this.setDirtyCanvas(true, true);
              return true;
            }
          }
          // 点击面板上方空白（文字区下方）也收起
          const panelTop = this.size[1] - 176;
          if (pos[1] > panelTop + 170 || pos[1] < 10) {
            this._editMode = false;
            this.setDirtyCanvas(true, true);
            return true;
          }
        }
        return false;
      }
    }

    LiteGraph.registerNodeType("WJZ_BigLabel", WJZBigLabel);
    // 去掉右上角 frontend_only 徽标（仅影响显示，不影响节点行为）
    if (WJZBigLabel.frontend_only !== undefined) WJZBigLabel.frontend_only = false;
  },
});
