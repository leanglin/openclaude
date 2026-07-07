# MarkItDown MCP Server 使用说明

本文说明如何在安装版 Web UI 里添加并使用 MarkItDown MCP Server。

默认配置：

- Name: `markitdown`
- Scope: `user`
- Transport: `stdio`
- Command: `uvx`
- Args: `markitdown-mcp`

## 先确认这不是 Marketplace

`https://github.com/mcp/microsoft/markitdown` 是 MCP Registry 条目页，不是插件 Marketplace。

不要把这个地址填到 `插件 Marketplace` 的 Source 输入框里。Marketplace 用来添加插件市场；MarkItDown 这种 MCP server 要在 `工具 -> MCP Servers` 里添加。

## 1. 安装或确认 uvx 可用

MarkItDown 推荐通过 `uvx markitdown-mcp` 启动。先在 PowerShell 里检查：

```powershell
uvx --version
```

如果提示找不到 `uvx`，先检查系统里有没有 `winget`：

```powershell
winget --version
```

### 如果没有 winget

`winget` 是 Windows Package Manager 命令，通常随 Microsoft 的 `App Installer` 提供。

推荐先打开 Microsoft Store，搜索并安装或更新 `App Installer`。完成后重新打开 PowerShell，再检查：

```powershell
winget --version
```

如果 `App Installer` 已安装，但当前用户第一次登录后 `winget` 没有注册，可以在 PowerShell 里运行 Microsoft 官方注册命令：

```powershell
Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
```

运行后重新打开 PowerShell，再检查：

```powershell
winget --version
```

### 用 winget 安装 uv

确认 `winget` 可用后，安装 `uv`：

```powershell
winget install --id=astral-sh.uv -e
```

### 没有 winget 时直接安装 uv

如果暂时不能安装或修复 `winget`，也可以使用 `uv` 官方 PowerShell 安装脚本：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

如果你想先查看脚本内容，再决定是否运行：

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | more"
```

### 验证 uvx

安装后重新打开 PowerShell，再检查：

```powershell
uvx --version
Get-Command uvx
```

如果 Web UI 是从安装版应用里启动的，安装 `uv` 后建议完整退出并重新打开应用，让应用进程重新读取 PATH。

## 2. 在 Web UI 添加 MarkItDown

进入 Web UI 后：

1. 打开一级菜单 `工具`。
2. 切换到 `MCP Servers`。
3. 如果页面有 `MarkItDown 示例` 按钮，可以直接点击它自动填表。
4. 如果手动填写，使用下面配置：

| 字段 | 值 |
| --- | --- |
| Name | `markitdown` |
| Scope | `user` |
| Transport | `stdio` |
| Command | `uvx` |
| Args | `markitdown-mcp` |
| Env | 留空 |

点击 `添加 MCP Server`。

添加成功后，Web UI 会提示类似“已添加，下次刷新会话后生效”。这表示配置已经写入，但当前正在运行的会话不会被静默重启。

## 3. 刷新会话让工具生效

添加完成后，执行其中一种操作：

- 刷新当前 Web CLI 会话。
- 或新建一个聊天会话。
- 如果刚安装过 `uv`，完整退出并重新打开安装版应用。

刷新后，模型才会重新加载 MCP server 列表。

## 4. 实际使用方式

在聊天里明确要求模型使用 MarkItDown MCP server 转换文件，例如：

```text
请使用 markitdown MCP server，把这个文件转换成 Markdown：
file:///C:/Users/leanglin/Desktop/test.docx
```

Windows 本地文件建议使用 `file:///C:/...` 这种 URI 写法，不要直接写 `C:\...`。

如果路径里有空格，可以保留完整路径并用引号包起来，例如：

```text
请使用 markitdown MCP server，把这个文件转换成 Markdown：
"file:///C:/Users/leanglin/Desktop/My Report.docx"
```

第一次运行 `uvx markitdown-mcp` 时可能需要联网下载包，等待时间会比后续运行更长。

## 备用方案：CLI 添加

如果 Web UI 暂时不可用，可以用 CLI 添加到 user scope：

```powershell
openclaude mcp add -s user markitdown -- uvx markitdown-mcp
```

添加后同样需要刷新或重启 Web UI 会话。

## 备用方案：项目级 .mcp.json

如果只想在当前项目里启用，可以在项目根目录创建或编辑 `.mcp.json`：

```json
{
  "mcpServers": {
    "markitdown": {
      "type": "stdio",
      "command": "uvx",
      "args": ["markitdown-mcp"]
    }
  }
}
```

这种方式是项目级配置，不是 user scope。切换到其他项目时不会自动带过去。

## 常见问题

### 把 GitHub Registry 地址填进 Marketplace 会怎样？

会失败。`https://github.com/mcp/microsoft/markitdown` 是 Registry 条目页，不是 marketplace 仓库，也不是 raw `marketplace.json`。

正确做法是在 `工具 -> MCP Servers` 中添加：

```text
uvx markitdown-mcp
```

### 添加成功但模型还是不会用？

通常是当前会话还没有刷新。添加 MCP server 后需要刷新 Web CLI 会话或新建聊天。

如果刚安装过 `uv`，还需要完整重启安装版应用，确保应用进程能找到新的 `uvx` 命令。

### `uvx` 在 PowerShell 可用，但 Web UI 里不可用？

这通常是 PATH 没有被已经运行的应用进程读取到。完整退出安装版应用后重新打开，再刷新会话。

### 可以把 Glama 列表页直接添加吗？

不可以。`https://glama.ai/mcp/servers` 是 MCP server 列表页，不是一个可直接运行的 MCP server 配置。

需要进入具体 server 的详情页，找到它提供的 command、args 或 HTTP/SSE URL，然后在 `MCP Servers` 表单里添加。

## 参考资料

- Microsoft WinGet 官方文档：`https://learn.microsoft.com/en-us/windows/package-manager/winget/`
- uv 官方安装文档：`https://docs.astral.sh/uv/getting-started/installation/`
