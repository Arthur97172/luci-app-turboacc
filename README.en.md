# luci-app-turboacc

English · [简体中文](README.md)

LuCI frontend for TurboACC, rewritten for **firewall4 (nftables)** in pure JavaScript and ucode.
It enables software/hardware flow offloading, vendor hardware NAT, full-cone NAT and TCP
congestion control on OpenWrt / ImmortalWrt.

Highlights:

- the frontend uses the **LuCI JavaScript** API, the backend uses **ucode + nftables**;
- **firewall4 only**;
- a single `all` / `noarch` package works on **ARM and x86** (and MIPS, etc.); available
  features are decided at runtime from the hardware;
- light and **dark themes switch automatically**, no manual toggle;
- tuned for **luci-theme-bootstrap** (default in OpenWrt 24.10 / 25.12) and
  **luci-theme-argon 2.x / 3.x**.

## Features

| Feature | Description |
| --- | --- |
| Flow offloading | Software / hardware offload implemented by firewall4 |
| Fast classifier | Shortcut-FE `fast_classifier` module (bridge and IPv6 toggles) |
| Shortcut-FE CM | `shortcut_fe_cm` connection manager |
| MediaTek HNAT | Vendor hardware NAT (`mtkhnat`), Ethernet / IPv6 / WED wireless |
| Qualcomm NSS | `qca-nss-ecm` acceleration daemon |
| Full-cone NAT | nftables `fullcone` statement or Broadcom `masquerade fullcone`, with IPv6 |
| TCP congestion control | Chosen from the algorithms the kernel actually exposes |

The status card polls every five seconds and shows the engine that is really active, hardware
offload, full-cone mode, congestion control algorithm and platform details.

## Requirements

- OpenWrt / ImmortalWrt **24.10** (opkg) or **25.12** (apk), or contemporary snapshots;
- **firewall4** — the package depends on it;
- `ucode` with its `fs` and `uci` modules (shipped by default since OpenWrt 24.10).

The package does not build kernel modules. Vendor acceleration (HNAT, NSS, SFE) requires
modules already provided by the device firmware or a third-party feed; the page only offers
what the running system supports.

## Install

Download the package matching the system from
[Releases](https://github.com/Arthur97172/luci-app-turboacc/releases):

```sh
# OpenWrt / ImmortalWrt 24.10 and older (opkg)
opkg install luci-app-turboacc_*.ipk
opkg install luci-i18n-turboacc-zh-cn_*.ipk    # optional: Chinese translation

# OpenWrt / ImmortalWrt 25.12+ (apk)
apk add --allow-untrusted luci-app-turboacc-*.apk
apk add --allow-untrusted luci-i18n-turboacc-zh-cn-*.apk
```

Packages are architecture independent (ipk `Architecture: all`, apk `noarch`), so one file
fits ARM and x86 alike. After installation the page is at **Network → TurboACC**.

Uninstall:

```sh
opkg remove luci-app-turboacc   # 24.10
apk del luci-app-turboacc       # 25.12
```

## Build and test locally

The tests need nothing but Node.js:

```sh
node tests/run.js
```

Compiling needs the SDK matching the target release:

```sh
# 24.10 x86/64 as an example
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

The packages land in `sdk/bin/packages/*/base/`, including `luci-i18n-turboacc-zh-cn`.

## How it works

`/etc/config/turboacc` is the single source of truth:

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

Saving the page makes ucitrack run `/etc/init.d/turboacc reload`, which invokes
`/usr/share/ucode/turboacc/main.uc apply`:

1. read the configuration;
2. **probe capabilities**: parse `/usr/share/ucode/fw4.uc` for the options the installed
   firewall4 supports (`flow_offloading_hw_ipv6`, `fullcone`, `fullcone6`, `tcpcca`, the
   MediaTek HNAT `flow_offloading=3` mode, ...) and dry-run full-cone rules with `nft -c`;
3. fall back to `disabled` when the selected engine is not usable, never leaving a half
   enabled state;
4. stop engines that must not run (`rmmod`, HNAT `hook_toggle`), start the selected one;
5. write only the firewall4 options that are actually supported into
   `@defaults[0]` of the `firewall` config, and reload the firewall only when values changed
   and fw4 is running.

As a result:

- stock OpenWrt only shows software/hardware flow offloading and TCP congestion control;
- full-cone options appear only when the lede / ImmortalWrt fullcone patches are present;
- MediaTek HNAT and WED require a `mtkhnat` module or HNAT debugfs node;
- Qualcomm NSS requires `qca-nss-ecm`.

## Themes

`view/turboacc/turboacc.css` deliberately sets **no** background or text colours — everything
inherits the theme palette, and only the status dots are coloured:

- **luci-theme-bootstrap**: light inherits; dark matches `:root[data-darkmode="true"]`;
- **luci-theme-argon 3.x**: dark matches `:root[data-argon-mode="dark"]`, and
  `prefers-color-scheme: dark` works while an explicit light choice
  (`:not([data-argon-mode="light"])`) is respected;
- **luci-theme-argon 2.x**: its dark mode swaps in a separate `dark.css` without any marker;
  since the stylesheet never hardcodes colours, it follows the theme anyway.

No manual switching is required.

## Layout

```
Makefile                                  # LuCI package (LUCI_PKGARCH:=all)
htdocs/luci-static/resources/
  view/turboacc.js                        # LuCI JavaScript view
  view/turboacc/turboacc.css              # theme-neutral styles
  turboacc/utils.js                       # pure helpers (testable under Node)
po/templates/turboacc.pot                 # translation template
po/zh_Hans/turboacc.po                    # Simplified Chinese translation
root/etc/config/turboacc                  # default configuration
root/etc/init.d/turboacc                  # non-procd service, triggered by ucitrack
root/etc/uci-defaults/90-turboacc         # pick an engine on first install
root/usr/share/ucode/turboacc/core.uc     # backend core
root/usr/share/ucode/turboacc/main.uc     # CLI entry point
root/usr/share/rpcd/ucode/luci.turboacc   # rpcd status plugin
root/usr/share/{luci/menu.d,rpcd/acl.d,ucitrack}/...
tests/                                    # Node.js test suite
.github/workflows/build.yml               # builds ipk / apk and publishes a release
```

## CI

`.github/workflows/build.yml` runs on push and on demand:

1. `node tests/run.js`;
2. builds with four SDK combinations: OpenWrt 24.10.8 (ipk) and 25.12.6 (apk), each on
   `x86/64` and `armsr/armv8`;
3. verifies package metadata (URL, maintainer, architecture) and contents;
4. publishes `.ipk`, `.apk` and the Chinese translation to a release named
   `PKG_VERSION-rPKG_RELEASE`.

## License

GPL-3.0-only, see [LICENSE](LICENSE).
