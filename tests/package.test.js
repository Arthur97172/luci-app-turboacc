'use strict';

const { ok, eq, summary, read, exists, mode, files } = require('./lib');

const required = [
	'Makefile',
	'LICENSE',
	'README.md',
	'README.en.md',
	'htdocs/luci-static/resources/view/turboacc.js',
	'htdocs/luci-static/resources/view/turboacc/turboacc.css',
	'htdocs/luci-static/resources/turboacc/utils.js',
	'po/templates/turboacc.pot',
	'po/zh_Hans/turboacc.po',
	'root/etc/config/turboacc',
	'root/etc/init.d/turboacc',
	'root/etc/uci-defaults/90-turboacc',
	'root/usr/share/luci/menu.d/luci-app-turboacc.json',
	'root/usr/share/rpcd/acl.d/luci-app-turboacc.json',
	'root/usr/share/rpcd/ucode/luci.turboacc',
	'root/usr/share/ucitrack/luci-app-turboacc.json',
	'root/usr/share/ucode/turboacc/core.uc',
	'root/usr/share/ucode/turboacc/main.uc',
	'.github/workflows/build.yml'
];

for (const file of required)
	ok(exists(file), 'required file exists: ' + file);

const makefile = read('Makefile');

ok(/^PKG_NAME:=luci-app-turboacc$/m.test(makefile), 'Makefile sets PKG_NAME');
ok(/^PKG_VERSION:=\d+\.\d+\.\d+$/m.test(makefile), 'Makefile sets a semver PKG_VERSION');
ok(/^PKG_RELEASE:=\d+$/m.test(makefile), 'Makefile sets a numeric PKG_RELEASE');
ok(/^LUCI_PKGARCH:=all$/m.test(makefile), 'package is architecture independent');
ok(/^LUCI_URL:=https:\/\/github\.com\/Arthur97172\/luci-app-turboacc$/m.test(makefile), 'Makefile sets LUCI_URL');
ok(/^LUCI_MAINTAINER:=Arthur97172 <Arthur97172@users\.noreply\.github\.com>$/m.test(makefile), 'Makefile sets LUCI_MAINTAINER');
ok(/LUCI_DEPENDS:=.*\+luci-base/.test(makefile), 'depends on luci-base');
ok(/LUCI_DEPENDS:=.*\+firewall4/.test(makefile), 'depends on firewall4');
ok(/LUCI_DEPENDS:=.*\+ucode/.test(makefile), 'depends on ucode');
ok(/include \$\(TOPDIR\)\/feeds\/luci\/luci\.mk/.test(makefile), 'includes luci.mk');
ok(/^# call BuildPackage - OpenWrt buildroot signature$/m.test(makefile),
	'Makefile carries the BuildPackage marker the metadata scanner greps for');
ok(!/firewall3|iptables|ip6tables/.test(makefile), 'Makefile does not mention firewall3/iptables');

const init = read('root/etc/init.d/turboacc');
ok(/^START=90$/m.test(init), 'init script starts late');
ok(!/^USE_PROCD=/m.test(init), 'init script is not procd (ucitrack reload trigger)');
ok(init.includes('/usr/share/ucode/turboacc/main.uc'), 'init script calls the ucode runner');
ok(mode('root/etc/init.d/turboacc') & 0o111, 'init script is executable');
ok(mode('root/etc/uci-defaults/90-turboacc') & 0o111, 'uci-defaults script is executable');

const defaults = read('root/etc/uci-defaults/90-turboacc');
ok(defaults.includes('main.uc defaults'), 'uci-defaults runs engine detection');
ok(defaults.includes('/etc/init.d/ucitrack restart'), 'uci-defaults refreshes ucitrack triggers');
ok(defaults.includes('/etc/init.d/rpcd reload'), 'uci-defaults loads the rpcd status plugin');

const config = read('root/etc/config/turboacc');
ok(/^config turboacc 'config'$/m.test(config), 'config ships the config section');

const configOptions = [
	'fastpath', 'fastpath_fo_hw', 'fastpath_fo_hw_ipv6',
	'fastpath_fc_br', 'fastpath_fc_ipv6',
	'fastpath_mh_eth_hnat', 'fastpath_mh_eth_hnat_v6', 'fastpath_mh_eth_hnat_wed',
	'fullcone', 'fullcone6', 'tcpcca'
];

for (const option of configOptions)
	ok(new RegExp('^\\toption ' + option + ' ', 'm').test(config), 'config defines ' + option);

const jsonFiles = {
	'root/usr/share/luci/menu.d/luci-app-turboacc.json': doc => doc['admin/network/turboacc'] != null,
	'root/usr/share/rpcd/acl.d/luci-app-turboacc.json': doc => doc['luci-app-turboacc'] != null,
	'root/usr/share/ucitrack/luci-app-turboacc.json': doc => doc.config === 'turboacc'
};

for (const [ file, check ] of Object.entries(jsonFiles)) {
	let doc = null;

	try {
		doc = JSON.parse(read(file));
	}
	catch (e) {
		ok(false, 'valid JSON: ' + file, e.message);
		continue;
	}

	ok(check(doc), 'expected structure: ' + file);
}

const menu = JSON.parse(read('root/usr/share/luci/menu.d/luci-app-turboacc.json'));
eq(menu['admin/network/turboacc'].action.path, 'turboacc', 'menu points at the turboacc view');

const acl = JSON.parse(read('root/usr/share/rpcd/acl.d/luci-app-turboacc.json'))['luci-app-turboacc'];
eq(acl.read.ubus['luci.turboacc'], [ 'getSystemFeatures', 'getStatus' ], 'ACL grants the rpcd methods');
eq(acl.read.uci, [ 'turboacc' ], 'ACL grants read access to turboacc');
eq(acl.write.uci, [ 'turboacc' ], 'ACL grants write access to turboacc');

const ucitrack = JSON.parse(read('root/usr/share/ucitrack/luci-app-turboacc.json'));
eq(ucitrack.exec, '/etc/init.d/turboacc reload', 'ucitrack reloads turboacc on config change');

const tracked = files('.').filter(file => file.endsWith('.lua') || file.endsWith('.lmo'));
eq(tracked, [], 'no Lua sources in the package');

const forbidden = /firewall3|xt_FLOWOFFLOAD|xt_FULLCONENAT|iptables-restore|ip6tables/;
const sources = files('root').map(file => ({ file, body: read('root/' + file) }));

for (const source of sources)
	ok(!forbidden.test(source.body), 'no firewall3 residue in root/' + source.file);

const workflow = read('.github/workflows/build.yml');
const sdkUrls = workflow.match(/https:\/\/downloads\.openwrt\.org\/releases\/[^\s"']+\.tar\.zst/g) || [];

eq(sdkUrls.length, 2, 'CI uses one SDK per package format (ipk and apk)');
ok(sdkUrls.every(url => url.includes('/targets/x86/64/')), 'CI SDKs are x86/64; the package itself is architecture independent');
ok(!/armsr|armv8/.test(workflow), 'CI does not build a redundant second architecture');
eq((workflow.match(/f=\$\(realpath "\$f"\)/g) || []).length, 2,
	'ipk checks take absolute paths because they cd into a temp dir');

summary('package.test.js');
