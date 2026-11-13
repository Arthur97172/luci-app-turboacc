// SPDX-License-Identifier: GPL-3.0-only
//
// Copyright (C) 2026 Arthur97172
//
// TurboACC runtime core. Shared by the CLI entry point (main.uc), the
// rpcd status plugin and the init script.

'use strict';

import * as fs from 'fs';
import * as uci from 'uci';

const CONFIG = 'turboacc';
const SECTION = 'config';
const FWCONFIG = 'firewall';
const FWDEFAULTS = '@defaults[0]';

const HNAT = '/sys/kernel/debug/hnat';
const KERNEL = trim(fs.readfile('/proc/sys/kernel/osrelease') ?? '');
const MODDIR = '/lib/modules/' + KERNEL;

const WED_PARAMS = [
	'/sys/module/mt7915e/parameters/wed_enable',
	'/sys/module/mt7996e/parameters/wed_enable'
];

const HW_COMPAT = /(mediatek,mt(7621|7622|7623|7629|7981|7986|7988|2701)|qcom,ipq(40|60|80|95)|marvell,armada|airoha,(en|an)[0-9])/;

function read_text(path) {
	let value = fs.readfile(path);

	return value != null ? trim(value) : null;
}

function read_int(path) {
	let value = read_text(path);

	return value != null && match(value, /^-?[0-9]+$/) ? int(value) : null;
}

function write_text(path, value) {
	return fs.writefile(path, value) != null;
}

function module_dir(name) {
	let st = fs.stat('/sys/module/' + name);

	// fs.stat() spells the type out in full ("directory"); older ucode
	// releases used the shorter "dir".
	return st != null && (st.type == 'directory' || st.type == 'dir' || st.type == 'link');
}

function module_file(name) {
	return fs.access(MODDIR + '/' + name + '.ko') ||
	       fs.access(MODDIR + '/' + name + '.ko.xz') ||
	       fs.access(MODDIR + '/' + name + '.ko.gz');
}

function module_available(name) {
	let builtin;

	if (module_dir(name) || module_file(name))
		return true;

	builtin = fs.readfile(MODDIR + '/modules.builtin');

	return builtin != null && index(builtin, name + '.ko') >= 0;
}

function module_refcnt(name) {
	return read_int('/sys/module/' + name + '/refcnt') ?? 0;
}

function boolval(value) {
	let v;

	if (value == null)
		return false;

	v = lc(trim('' + value));

	return v == '1' || v == 'true' || v == 'yes' || v == 'on' || v == 'enabled';
}

function fw4_caps() {
	let src = fs.readfile('/usr/share/ucode/fw4.uc');
	let caps = {
		fw4: src != null,
		flow_offloading: false,
		flow_offloading_hw: false,
		flow_offloading_hw_ipv6: false,
		fullcone: false,
		fullcone6: false,
		tcpcca: false,
		hnat_mode: false
	};

	if (src == null)
		return caps;

	caps.flow_offloading = match(src, /flow_offloading\s*:\s*\[\s*"bool"/) != null;
	caps.flow_offloading_hw = match(src, /flow_offloading_hw\s*:\s*\[\s*"bool"/) != null;
	caps.flow_offloading_hw_ipv6 = match(src, /flow_offloading_hw_ipv6\s*:\s*\[\s*"bool"/) != null;
	caps.fullcone = match(src, /fullcone\s*:\s*\[\s*"(bool|int)"/) != null;
	caps.fullcone6 = match(src, /fullcone6\s*:\s*\[\s*"bool"/) != null;
	caps.tcpcca = match(src, /tcpcca\s*:\s*\[\s*"string"/) != null;
	caps.hnat_mode = match(src, /flow_offloading\s*==\s*"3"/) != null;

	return caps;
}

function boardinfo() {
	let src = fs.readfile('/etc/openwrt_release') ?? '';
	let target = match(src, /DISTRIB_TARGET='([^']*)'/);
	let arch = match(src, /DISTRIB_ARCH='([^']*)'/);
	let release = match(src, /DISTRIB_RELEASE='([^']*)'/);

	return {
		target: target ? target[1] : null,
		arch: arch ? arch[1] : null,
		release: release ? release[1] : null
	};
}

function hw_platform() {
	let compat = fs.readfile('/proc/device-tree/compatible') ??
	             fs.readfile('/sys/firmware/devicetree/base/compatible');

	if (compat != null && match(compat, HW_COMPAT) != null)
		return true;

	// ipq40xx NSS / MediaTek PPE drivers registered at runtime
	return module_dir('qca_ssdk') || module_dir('ess_edma') || module_dir('mtk_ppe');
}

function hnat_available() {
	return module_available('mtkhnat') || fs.access(HNAT) != null;
}

function hnat_enabled() {
	let value = read_text(HNAT + '/hook_toggle');

	if (value == null)
		return false;

	value = lc(value);

	return value == '1' || value == 'enabled' || value == 'y' || value == 'yes';
}

function hnat_wlan() {
	let i, value, handle, out;

	for (i = 0; i < length(WED_PARAMS); i++) {
		value = read_text(WED_PARAMS[i]);

		if (value != null)
			return value == 'Y' || value == '1' || value == 'y';
	}

	handle = fs.popen("grep -l 'WHNAT=1' /etc/wireless/mediatek/*_card*.dat 2>/dev/null");

	if (handle == null)
		return null;

	out = handle.read('all');
	handle.close();

	return out != null && trim(out) != '';
}

function find_wed() {
	let i;

	for (i = 0; i < length(WED_PARAMS); i++)
		if (fs.access(WED_PARAMS[i]))
			return WED_PARAMS[i];

	return null;
}

function nft_bin() {
	return fs.access('/usr/sbin/nft') ? '/usr/sbin/nft' :
	       fs.access('/sbin/nft') ? '/sbin/nft' : null;
}

function nft_probe(expression) {
	let nft = nft_bin();

	if (nft == null)
		return false;

	let command = sprintf(
		"%s -c 'add table inet turboacc_probe; " +
		"add chain inet turboacc_probe c { type nat hook postrouting priority srcnat; policy accept; %s; }; ' " +
		">/dev/null 2>&1", nft, expression);

	return system(command) == 0;
}

function read_cca() {
	let value = read_text('/proc/sys/net/ipv4/tcp_available_congestion_control');

	if (value == null)
		return [];

	return filter(split(value, ' '), function(item) { return item != ''; });
}

function cca_value(value, available) {
	if (value != null && index(available, value) >= 0)
		return value;

	if (index(available, 'cubic') >= 0)
		return 'cubic';

	return length(available) ? available[0] : 'cubic';
}

function fullcone_modes(caps) {
	let nft_mod = module_available('nft_fullcone');
	let nft = caps.fullcone && (nft_mod || nft_probe('fullcone'));
	let broadcom = caps.fullcone && !nft_mod && nft_probe('masquerade fullcone');

	return { nft: nft, broadcom: broadcom };
}

function detect() {
	let caps = fw4_caps();
	let board = boardinfo();
	let fc = fullcone_modes(caps);

	return {
		target: board.target,
		arch: board.arch,
		release: board.release,
		kernel: KERNEL,
		fw4: caps.fw4,
		offloading: caps.flow_offloading,
		offloading_hw: caps.flow_offloading_hw && hw_platform(),
		offloading_hw_ipv6: caps.flow_offloading_hw_ipv6,
		hnat_mode: caps.hnat_mode,
		engines: {
			flow_offloading: caps.flow_offloading,
			fast_classifier: module_available('fast_classifier'),
			shortcut_fe_cm: module_available('shortcut_fe_cm'),
			mediatek_hnat: hnat_available(),
			qca_nss_ecm: fs.access('/etc/init.d/qca-nss-ecm') != null
		},
		fullcone: caps.fullcone,
		fullcone_nft: fc.nft,
		fullcone_broadcom: fc.broadcom,
		tcpcca: fs.access('/proc/sys/net/ipv4/tcp_congestion_control') != null,
		cca: read_cca(),
		wed: find_wed() != null
	};
}

function read_settings(cursor) {
	let fo_hw = boolval(cursor.get(CONFIG, SECTION, 'fastpath_fo_hw'));
	let fo_hw_ipv6 = cursor.get(CONFIG, SECTION, 'fastpath_fo_hw_ipv6');
	let fullcone = cursor.get(CONFIG, SECTION, 'fullcone') ?? '0';

	return {
		fastpath: cursor.get(CONFIG, SECTION, 'fastpath') ?? 'disabled',
		fo_hw: fo_hw,
		fo_hw_ipv6: fo_hw_ipv6 == null ? true : boolval(fo_hw_ipv6),
		fc_br: boolval(cursor.get(CONFIG, SECTION, 'fastpath_fc_br') ?? '1'),
		fc_ipv6: boolval(cursor.get(CONFIG, SECTION, 'fastpath_fc_ipv6') ?? '1'),
		mh_eth: boolval(cursor.get(CONFIG, SECTION, 'fastpath_mh_eth_hnat') ?? '1'),
		mh_v6: boolval(cursor.get(CONFIG, SECTION, 'fastpath_mh_eth_hnat_v6') ?? '1'),
		wed: boolval(cursor.get(CONFIG, SECTION, 'fastpath_mh_eth_hnat_wed')),
		fullcone: fullcone,
		fullcone6: boolval(cursor.get(CONFIG, SECTION, 'fullcone6')),
		tcpcca: cursor.get(CONFIG, SECTION, 'tcpcca') ?? 'cubic'
	};
}

function normalize_fastpath(value) {
	if (value == 'flow_offloading' || value == 'fast_classifier' ||
	    value == 'shortcut_fe_cm' || value == 'mediatek_hnat' ||
	    value == 'qca_nss_ecm')
		return value;

	return 'disabled';
}

function engine_usable(engine, caps, features) {
	if (engine == 'flow_offloading')
		return caps.flow_offloading;

	if (engine == 'qca_nss_ecm')
		return features.engines.qca_nss_ecm;

	return features.engines[engine] == true;
}

function stop_engine(engine) {
	if (engine != 'fast_classifier') {
		if (fs.access('/sys/fast_classifier/skip_to_bridge_ingress'))
			write_text('/sys/fast_classifier/skip_to_bridge_ingress', '0');

		if (module_dir('fast_classifier')) {
			system('rm -f /dev/sfe_ipv6');
			system('rmmod fast_classifier 2>/dev/null');
		}
	}

	if (engine != 'shortcut_fe_cm' && module_dir('shortcut_fe_cm'))
		system('rmmod shortcut_fe_cm 2>/dev/null');

	if (engine != 'mediatek_hnat' && fs.access(HNAT + '/hook_toggle'))
		write_text(HNAT + '/hook_toggle', '0');
}

function start_engine(engine, settings) {
	if (engine == 'fast_classifier') {
		if (!module_dir('fast_classifier'))
			system('modprobe fast_classifier 2>/dev/null');

		if (module_dir('fast_classifier')) {
			write_text('/sys/fast_classifier/skip_to_bridge_ingress', settings.fc_br ? '1' : '0');

			if (settings.fc_ipv6) {
				let dev = read_text('/sys/sfe_ipv6/debug_dev');

				if (dev != null && dev != '' && !fs.access('/dev/sfe_ipv6'))
					system('mknod /dev/sfe_ipv6 c ' + dev + ' 0');
			}
			else {
				system('rm -f /dev/sfe_ipv6');
			}

			return true;
		}

		return false;
	}

	if (engine == 'shortcut_fe_cm') {
		if (!module_dir('shortcut_fe_cm'))
			system('modprobe shortcut_fe_cm 2>/dev/null');

		return module_dir('shortcut_fe_cm');
	}

	if (engine == 'mediatek_hnat') {
		if (!fs.access(HNAT))
			return false;

		write_text(HNAT + '/hnat_setting', sprintf('8 %d', settings.mh_v6 ? 1 : 0));
		write_text(HNAT + '/hook_toggle', settings.mh_eth ? '1' : '0');

		return true;
	}

	if (engine == 'qca_nss_ecm') {
		if (!fs.access('/etc/init.d/qca-nss-ecm'))
			return false;

		system('/etc/init.d/qca-nss-ecm restart >/dev/null 2>&1');

		return true;
	}

	return true;
}

function desired_firewall(engine, settings, caps, features) {
	let desired = {};

	if (caps.flow_offloading) {
		if (engine == 'flow_offloading')
			desired.flow_offloading = '1';
		else if (engine == 'mediatek_hnat' && caps.hnat_mode && settings.mh_eth)
			desired.flow_offloading = '3';
		else
			desired.flow_offloading = '0';
	}

	if (caps.flow_offloading_hw)
		desired.flow_offloading_hw = (engine == 'flow_offloading' && settings.fo_hw && features.offloading_hw) ? '1' : '0';

	if (caps.flow_offloading_hw_ipv6)
		desired.flow_offloading_hw_ipv6 = settings.fo_hw_ipv6 ? '1' : '0';

	if (caps.fullcone) {
		let mode = settings.fullcone;

		if (mode != '1' && mode != '2')
			mode = '0';

		if (mode == '1' && !features.fullcone_nft)
			mode = '0';

		if (mode == '2' && !features.fullcone_broadcom)
			mode = '0';

		desired.fullcone = mode;
	}

	if (caps.fullcone6)
		desired.fullcone6 = (settings.fullcone6 && features.fullcone_nft) ? '1' : '0';

	if (caps.tcpcca)
		desired.tcpcca = cca_value(settings.tcpcca, features.cca);

	return desired;
}

function commit_firewall(desired) {
	let cursor = uci.cursor();
	let changed = false;
	let key, current;

	if (cursor.get(FWCONFIG, FWDEFAULTS) == null)
		return false;

	for (key in desired) {
		current = cursor.get(FWCONFIG, FWDEFAULTS, key);

		if (current == null || '' + current != desired[key]) {
			cursor.set(FWCONFIG, FWDEFAULTS, key, desired[key]);
			changed = true;
		}
	}

	if (!changed)
		return false;

	cursor.commit(FWCONFIG);

	if (fs.access('/var/run/fw4.state'))
		system('/etc/init.d/firewall reload >/dev/null 2>&1');

	return true;
}

function apply_cca(value) {
	let available = read_cca();

	if (!length(available))
		return;

	write_text('/proc/sys/net/ipv4/tcp_congestion_control', cca_value(value, available));
}

function apply() {
	let cursor = uci.cursor();
	let settings = read_settings(cursor);
	let caps = fw4_caps();
	let features = detect();
	let engine = normalize_fastpath(settings.fastpath);

	if (!engine_usable(engine, caps, features))
		engine = 'disabled';

	stop_engine(engine);

	if (engine != 'disabled' && !start_engine(engine, settings))
		engine = 'disabled';

	let wed = find_wed();

	if (wed != null)
		write_text(wed, (engine == 'flow_offloading' && settings.fo_hw && features.offloading_hw && settings.wed) ? 'Y' : 'N');

	let desired = desired_firewall(engine, settings, caps, features);

	commit_firewall(desired);
	apply_cca(desired.tcpcca ?? settings.tcpcca);

	return 0;
}

function stop() {
	let caps = fw4_caps();
	let desired = {};

	stop_engine('disabled');

	if (caps.flow_offloading)
		desired.flow_offloading = '0';

	if (caps.flow_offloading_hw)
		desired.flow_offloading_hw = '0';

	if (caps.flow_offloading_hw_ipv6)
		desired.flow_offloading_hw_ipv6 = '1';

	if (caps.fullcone)
		desired.fullcone = '0';

	if (caps.fullcone6)
		desired.fullcone6 = '0';

	commit_firewall(desired);

	return 0;
}

function ensure_section(cursor) {
	if (cursor.get(CONFIG, SECTION) != null)
		return;

	cursor.load(CONFIG);

	let sid = cursor.add(CONFIG, 'turboacc');

	if (sid != null)
		cursor.rename(CONFIG, sid, SECTION);
}

function defaults() {
	let cursor = uci.cursor();
	let caps = fw4_caps();
	let features = detect();
	let engine = 'disabled';
	let cca = cca_value('cubic', features.cca);

	ensure_section(cursor);

	if (boolval(cursor.get(CONFIG, SECTION, 'initialized')))
		return 0;

	if (features.engines.qca_nss_ecm)
		engine = 'qca_nss_ecm';
	else if (features.engines.mediatek_hnat)
		engine = 'mediatek_hnat';
	else if (caps.flow_offloading)
		engine = 'flow_offloading';
	else if (features.engines.fast_classifier)
		engine = 'fast_classifier';
	else if (features.engines.shortcut_fe_cm)
		engine = 'shortcut_fe_cm';

	cursor.set(CONFIG, SECTION, 'fastpath', engine);
	cursor.set(CONFIG, SECTION, 'fastpath_fo_hw', (engine == 'flow_offloading' && features.offloading_hw) ? '1' : '0');
	cursor.set(CONFIG, SECTION, 'fastpath_fo_hw_ipv6', '1');
	cursor.set(CONFIG, SECTION, 'fastpath_fc_br', '1');
	cursor.set(CONFIG, SECTION, 'fastpath_fc_ipv6', '1');
	cursor.set(CONFIG, SECTION, 'fastpath_mh_eth_hnat', '1');
	cursor.set(CONFIG, SECTION, 'fastpath_mh_eth_hnat_v6', '1');
	cursor.set(CONFIG, SECTION, 'fastpath_mh_eth_hnat_wed', '0');

	if (features.fullcone_nft)
		cursor.set(CONFIG, SECTION, 'fullcone', '1');
	else if (features.fullcone_broadcom)
		cursor.set(CONFIG, SECTION, 'fullcone', '2');
	else
		cursor.set(CONFIG, SECTION, 'fullcone', '0');

	cursor.set(CONFIG, SECTION, 'fullcone6', '0');
	cursor.set(CONFIG, SECTION, 'tcpcca', cca);
	cursor.set(CONFIG, SECTION, 'initialized', '1');
	cursor.commit(CONFIG);

	return 0;
}

function status() {
	let result = {
		engine: null,
		hw: false,
		fullcone: null,
		cca: read_text('/proc/sys/net/ipv4/tcp_congestion_control'),
		hnat: null,
		running: fs.access('/var/run/fw4.state') != null
	};

	if (module_dir('ecm')) {
		result.engine = 'qca_nss_ecm';
	}
	else if (module_dir('fast_classifier')) {
		result.engine = 'fast_classifier';
	}
	else if (module_dir('shortcut_fe_cm')) {
		result.engine = 'shortcut_fe_cm';
	}
	else if (hnat_enabled()) {
		result.engine = 'mediatek_hnat';
		result.hnat = { eth: true, wlan: hnat_wlan() };
	}
	else if (module_refcnt('nft_flow_offload') > 0) {
		result.engine = 'flow_offloading';
	}

	if (result.engine == 'flow_offloading') {
		let cursor = uci.cursor();

		result.hw = cursor.get(FWCONFIG, FWDEFAULTS, 'flow_offloading_hw') == '1';
	}

	if (module_dir('nft_fullcone') && module_refcnt('nft_fullcone') > 0) {
		result.fullcone = 'nft';
	}
	else {
		let cursor = uci.cursor();
		let mode = cursor.get(FWCONFIG, FWDEFAULTS, 'fullcone');

		if (mode == '1' || mode == '2') {
			let nft = nft_bin();
			let handle = nft != null ? fs.popen(nft + ' list ruleset 2>/dev/null') : null;
			let rules = null;

			if (handle != null) {
				rules = handle.read('all');
				handle.close();
			}

			if (rules != null && index(rules, 'fullcone') >= 0)
				result.fullcone = index(rules, 'masquerade fullcone') >= 0 ? 'broadcom' : 'nft';
		}
	}

	return result;
}

export { detect, apply, stop, defaults, status };
