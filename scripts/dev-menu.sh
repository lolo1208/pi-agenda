#!/usr/bin/env bash

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." || exit 1

package_command=''
package_label='导出当前系统发行包'
case "$(uname -s)" in
  Darwin)
    package_command=dist:mac
    package_label='导出 macOS(x64) 安装包'
    ;;
  MINGW*|MSYS*|CYGWIN*)
    package_command=dist:win:all
    package_label='一次导出 Windows(x64) 安装包、便携版和 ZIP 包'
    ;;
esac

while true; do
  printf '\nPi Agenda · 行动派 — 命令菜单\n\n'
  printf '%s\n' \
    '1. 运行开发桌面端' \
    '2. 生成程序图标' \
    "a. $package_label" \
    '0. 退出'
  if [ "$package_command" = 'dist:win:all' ]; then
    printf '%s\n' 'b. 导出 Windows(x64) 安装包' 'c. 导出 Windows(x64) 便携版' 'd. 导出 Windows(x64) ZIP 包'
  fi
  printf '\n请输入菜单编号，按回车执行：'
  IFS= read -r selection || exit 0
  case "$selection" in
    1) command=dev ;;
    2) command=icons:generate ;;
    a|A)
      if [ -n "$package_command" ]; then
        command=$package_command
      else
        printf '当前系统暂不支持导出发行包，请选择其他菜单项。\n'
        continue
      fi
      ;;
    b|B|c|C|d|D)
      if [ "$package_command" != 'dist:win:all' ]; then
        printf '当前系统不支持 Windows 导出命令。\n'
        continue
      fi
      case "$selection" in
        b|B) command=dist:win ;;
        c|C) command=dist:win:portable ;;
        d|D) command=dist:win:zip ;;
      esac
      ;;
    0) exit 0 ;;
    *) printf '输入无效，请输入菜单中显示的编号并按回车。\n'; continue ;;
  esac
  if ! command -v pnpm >/dev/null 2>&1; then
    printf '未找到 pnpm，请先安装 pnpm 并加入 PATH 后重试。\n' >&2
    result=1
  else
    printf '\n正在执行：pnpm %s\n\n' "$command"
    pnpm "$command"
    result=$?
  fi

  if [ "$result" -eq 0 ]; then
    printf '\n执行成功。\n'
  else
    printf '\n执行失败（退出码：%s），请查看上方输出。\n' "$result" >&2
  fi
  printf '按任意键返回菜单...'
  IFS= read -r -s -n 1 _ || exit 0
  printf '\n'
done
