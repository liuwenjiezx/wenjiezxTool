# -*- coding: utf-8 -*-
"""
wenjiezxTool —— 个人功能工具箱（ComfyUI 自定义节点插件）

多版本兼容加载：根据运行环境的 Python 版本自动选择对应的闭源 .pyd
    - Python 3.12 -> nodes_cp312.pyd
    - Python 3.13 -> nodes_cp313.pyd
仅支持 Windows。
"""
import sys

_VER = sys.version_info[:2]

if _VER == (3, 12):
    from .nodes_cp312 import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
elif _VER == (3, 13):
    from .nodes_cp313 import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
else:
    raise RuntimeError(
        "wenjiezxTool 仅支持 Python 3.12 / 3.13 的 Windows 版 ComfyUI，"
        "当前运行 Python %d.%d，请使用对应版本的 ComfyUI" % _VER
    )

WEB_DIRECTORY = "web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
