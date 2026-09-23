# -*- coding: utf-8 -*-
"""
wenjiezxTool —— 个人功能工具箱（ComfyUI 自定义节点插件）

用途：把日常好用的小功能节点集中放在一个插件里，后续新增节点只需在
本目录的 nodes.py 中新增类并在 NODE_CLASS_MAPPINGS 注册即可。

前端扩展：web/ 目录下的 js 由 ComfyUI 自动挂载（画布大字标注等 UI 节点）。
"""
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
