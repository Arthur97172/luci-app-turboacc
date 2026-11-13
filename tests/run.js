'use strict';

const path = require('path');

const suites = [
	'utils.test.js',
	'package.test.js',
	'view.test.js',
	'ucode.test.js',
	'i18n.test.js'
];

for (const suite of suites)
	require(path.join(__dirname, suite));
