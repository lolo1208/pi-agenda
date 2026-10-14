$ErrorActionPreference = 'Stop'
$menuEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $menuEncoding
[Console]::OutputEncoding = $menuEncoding
$OutputEncoding = $menuEncoding

Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$menuCommands = @{
  '1' = 'dev'
  '2' = 'icons:generate'
  '3' = 'dist:win'
  '4' = 'dist:win:portable'
}

while ($true) {
  Write-Host ''
  Write-Host 'Pi Agenda · 行动派 — 命令菜单'
  Write-Host ''
  Write-Host '1. 运行开发桌面端'
  Write-Host '2. 生成程序图标'
  Write-Host '3. 导出当前系统发行包'
  Write-Host '4. 导出 Windows 便携版（单个 .exe，免安装）'
  Write-Host '0. 退出'
  Write-Host ''
  $selection = Read-Host '请输入菜单编号，按回车执行'
  if ($null -eq $selection) { exit 0 }
  $selection = $selection.Trim()
  if ($selection -eq '0') { exit 0 }
  if (-not $menuCommands.ContainsKey($selection)) {
    Write-Host '输入无效，请输入菜单中显示的编号并按回车。'
    continue
  }

  $result = 1
  try {
    $pnpmCommand = Get-Command pnpm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $pnpmCommand) {
      Write-Host '未找到 pnpm，请先安装 pnpm 并加入 PATH 后重试。'
    } else {
      $command = $menuCommands[$selection]
      Write-Host "`n正在执行：pnpm $command`n"
      & $pnpmCommand.Source $command
      $result = $LASTEXITCODE
    }
  } catch {
    Write-Host "命令启动失败：$($_.Exception.Message)"
    $result = 1
  }

  if ($result -eq 0) {
    Write-Host "`n执行成功。"
  } else {
    Write-Host "`n执行失败（退出码：$result），请查看上方输出。"
  }
  [void](Read-Host '按回车返回命令菜单')
}
