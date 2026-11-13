# SPDX-License-Identifier: GPL-3.0-only
#
# Copyright (C) 2026 Arthur97172

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-turboacc
PKG_VERSION:=1.0.3
PKG_RELEASE:=1

PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Arthur97172 <Arthur97172@users.noreply.github.com>

LUCI_TITLE:=LuCI support for TurboACC
LUCI_DESCRIPTION:=Accelerate the router forwarding path with firewall4 flow offloading, \
	Shortcut-FE, MediaTek HNAT, QCA NSS ECM, full-cone NAT and TCP congestion control. \
	The package is architecture independent and supports both ARM and x86 targets.
LUCI_DEPENDS:=+luci-base +firewall4 +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus
LUCI_PKGARCH:=all
LUCI_URL:=https://github.com/Arthur97172/luci-app-turboacc
LUCI_MAINTAINER:=Arthur97172 <Arthur97172@users.noreply.github.com>

include $(TOPDIR)/feeds/luci/luci.mk

# The buildroot metadata scanner finds packages by grepping their Makefile for
# this line, so it must stay even though luci.mk already calls BuildPackage.
# call BuildPackage - OpenWrt buildroot signature
