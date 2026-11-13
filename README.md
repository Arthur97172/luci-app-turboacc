# luci-app-turboacc

[English](README.en.md) · 简体中文

TurboACC 的 LuCI 前端，基于 **firewall4（nftables）** 重写，纯 JavaScript + ucode 实现。
用于给 OpenWrt / ImmortalWrt 开启软件/硬件流量卸载、厂商硬件 NAT、全锥形 NAT 与 TCP 拥塞控制。

本仓库的主要特点：

- 前端使用 **LuCI JavaScript**，后端使用 **ucode + nftables**；
- **只支持 firewall4**；
- 同一份 `all` / `noarch` 产物同时适用于 **ARM 与 x86**（以及 MIPS 等其它架构），运行时按硬件能力决定可用项；
- 自动适配 **亮色 / 暗色主题**，无需手动切换；
- 适配 **luci-theme-bootstrap**（OpenWrt 24.10 / 25.12 默认主题）与 **luci-theme-argon 2.x / 3.x**。

## 功能

| 功能 | 说明 |
| --- | --- |
| 流量卸载 | 由 firewall4 实现的软件 / 硬件 flow offloading |
| 快速分类器 | Shortcut-FE `fast_classifier` 内核模块（桥接、IPv6 开关） |
| Shortcut-FE CM | `shortcut_fe_cm` 连接管理器 |
| 联发科 HNAT | MediaTek `mtkhnat` 硬件 NAT（以太网 / IPv6 / WED 无线卸载） |
| 高通 NSS | `qca-nss-ecm` 加速守护进程 |
| 全锥形 NAT | nftables `fullcone` 语句或博通 `masquerade fullcone`，含 IPv6 开关 |
| TCP 拥塞控制 | 从系统实际可用算法中选择（如 cubic / bbr） |

页面顶部的运行状态卡片每 5 秒轮询一次，显示当前真正生效的引擎、硬件卸载、全锥形模式、
拥塞控制算法与平台信息。

## 环境要求

- OpenWrt / ImmortalWrt **24.10**（opkg）或 **25.12**（apk），或同代主线快照；
- **firewall4**：本包硬依赖 `firewall4`；
- `ucode` 及其 `fs` / `uci` 模块（OpenWrt 24.10 起为默认组件）。

软件包本身不编译内核模块。要使用厂商加速（HNAT、NSS、SFE），需要设备固件或第三方 feed
已经提供对应内核模块；页面只显示当前系统真正具备的选项。

## 安装

从 [Releases](https://github.com/Arthur97172/luci-app-turboacc/releases) 下载与系统版本对应的包：

```sh
# OpenWrt / ImmortalWrt 24.10 及更早（opkg）
opkg install luci-app-turboacc_*.ipk
opkg install luci-i18n-turboacc-zh-cn_*.ipk    # 可选：中文翻译

# OpenWrt / ImmortalWrt 25.12+（apk）
apk add --allow-untrusted luci-app-turboacc-*.apk
apk add --allow-untrusted luci-i18n-turboacc-zh-cn-*.apk
```

产物为架构无关包（ipk `Architecture: all`，apk `noarch`），同一份文件可装在 ARM 与 x86 上。
安装后刷新 LuCI 页面即可在 **网络 → TurboACC** 找到入口。

卸载：

```sh
opkg remove luci-app-turboacc   # 24.10
apk del luci-app-turboacc       # 25.12
```

## 本地构建与测试

测试不需要 OpenWrt 环境：

```sh
node tests/run.js
```

编译安装包需要对应版本的 SDK：

```sh
# 以 24.10 x86/64 为例
curl -LO https://downloads.openwrt.org/releases/24.10.8/targets/x86/64/openwrt-sdk-24.10.8-x86-64_gcc-13.3.0_musl.Linux-x86_64.tar.zst
tar -xf openwrt-sdk-24.10.8-*.tar.zst
mv openwrt-sdk-* sdk
mkdir -p sdk/package/luci-app-turboacc
cp -r Makefile htdocs po root sdk/package/luci-app-turboacc/
cd sdk
./scripts/feeds update -a && ./scripts/feeds install -a
make defconfig
make package/luci-app-turboacc/compile V=s
```

产物位于 `sdk/bin/packages/*/base/`，包含主包与 `luci-i18n-turboacc-zh-cn`。

## 工作原理

配置的唯一来源是 `/etc/config/turboacc`：

```uci
config turboacc 'config'
	option fastpath 'flow_offloading'
	option fastpath_fo_hw '0'
	option fastpath_fo_hw_ipv6 '1'
	option fastpath_fc_br '1'
	option fastpath_fc_ipv6 '1'
	option fastpath_mh_eth_hnat '1'
	option fastpath_mh_eth_hnat_v6 '1'
	option fastpath_mh_eth_hnat_wed '0'
	option fullcone '0'
	option fullcone6 '0'
	option tcpcca 'cubic'
```

保存页面时，ucitrack 触发 `/etc/init.d/turboacc reload`，由
`/usr/share/ucode/turboacc/main.uc apply` 完成实际动作：

1. 读取配置；
2. **探测能力**：从 `/usr/share/ucode/fw4.uc` 解析当前 firewall4 支持的选项
   （`flow_offloading_hw_ipv6`、`fullcone`、`fullcone6`、`tcpcca`、MediaTek HNAT 的
   `flow_offloading=3` 模式等），并用 `nft -c` 干跑验证全锥形语句是否可用；
3. 若所选引擎在当前系统不可用，自动回落到 `disabled`，不会留下半开状态；
4. 停止不应运行的引擎（`rmmod` / 关闭 HNAT `hook_toggle`），启动所选引擎；
5. 只把 firewall4 **确实支持**的选项写进 `firewall` 配置的 `@defaults[0]`，
   并且仅在选项真的变化、且 fw4 正在运行时才重载防火墙。

因此：

- 原版 OpenWrt 上只会出现软件/硬件 flow offloading 与 TCP 拥塞控制；
- 打了 lede / ImmortalWrt fullcone 补丁的系统才会出现全锥形选项；
- 有 `mtkhnat`（或 HNAT 调试节点）的系统才会出现联发科 HNAT 与 WED；
- 有 `qca-nss-ecm` 的系统才会出现高通 NSS。

## 主题适配

样式表 `view/turboacc/turboacc.css` 刻意**不设置**页面背景与文字颜色，全部继承主题自身配色，
只给状态圆点着色，因此：

- **luci-theme-bootstrap**：亮色直接继承；暗色通过 `:root[data-darkmode="true"]` 命中；
- **luci-theme-argon 3.x**：通过 `:root[data-argon-mode="dark"]` 命中，并在
  `prefers-color-scheme: dark` 下工作，但用户显式选择亮色
  （`:not([data-argon-mode="light"])`）时不覆盖；
- **luci-theme-argon 2.x**：其暗色会替换整份 `dark.css` 且不留标记，
  由于本样式不写死颜色，暗色下依然跟随主题。

无需任何手动切换。

## 目录结构

```
Makefile                                  # LuCI 包定义（LUCI_PKGARCH:=all）
htdocs/luci-static/resources/
  view/turboacc.js                        # LuCI JavaScript 视图
  view/turboacc/turboacc.css              # 主题中性样式
  turboacc/utils.js                       # 纯函数助手（可在 Node 中测试）
po/templates/turboacc.pot                 # 翻译模板
po/zh_Hans/turboacc.po                    # 简体中文翻译
root/etc/config/turboacc                  # 默认配置
root/etc/init.d/turboacc                  # 非 procd 服务，供 ucitrack 触发
root/etc/uci-defaults/90-turboacc         # 首次安装时自动选择引擎
root/usr/share/ucode/turboacc/core.uc     # 后端核心
root/usr/share/ucode/turboacc/main.uc     # CLI 入口
root/usr/share/rpcd/ucode/luci.turboacc   # rpcd 状态插件
root/usr/share/{luci/menu.d,rpcd/acl.d,ucitrack}/...
tests/                                    # Node.js 测试
.github/workflows/build.yml               # 构建 ipk / apk 并发布 Release
```

## CI

`.github/workflows/build.yml` 在 push 与手动触发时：

1. 运行 `node tests/run.js`；
2. 用两个 SDK 编译：OpenWrt 24.10.8（ipk）与 25.12.6（apk），均为 `x86/64`；
   产物与架构无关，同一份文件可直接安装到 ARM 设备；
3. 校验包元数据（URL、Maintainer、架构）与包内文件；
4. 把 `.ipk` / `.apk` 与中文翻译包发布到以 `PKG_VERSION-rPKG_RELEASE` 命名的 Release。

## 许可

GPL-3.0-only，见 [LICENSE](LICENSE)。
