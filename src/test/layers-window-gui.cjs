// Run with Electron (and a display): electron src/test/layers-window-gui.cjs [--source]
const {app} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const source = process.argv.includes('--source');
const stage = Number(process.env.DRAWIO_LAYERS_TEST_STAGE);
const states = [null, true, false, true, false];
const profile = Number.isNaN(stage) ? fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-layers-profile-')) :
	process.env.DRAWIO_LAYERS_TEST_PROFILE;
app.setPath('userData', Number.isNaN(stage) ? fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-layers-runner-')) : profile);
app.commandLine.appendSwitch('disable-gpu');
process.env.DRAWIO_DISABLE_UPDATE = 'true';
if (source) process.env.DRAWIO_ENV = 'dev';
else delete process.env.DRAWIO_ENV;
process.argv = [process.argv[0], root];
const errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const firstWindow = new Promise(resolve => app.once('browser-window-created', (_event, win) =>
{
	win.webContents.setUserAgent(win.webContents.getUserAgent() + ' draw.io/' + require('../../package.json').version);
	win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']},
		(_details, callback) => callback({cancel: true}));
	win.webContents.on('console-message', details =>
	{
		if (details.level === 'error' || details.message.startsWith('Plugin Error:')) errors.push(details.message);
	});
	win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
	resolve(win);
}));

(async () =>
{
	if (Number.isNaN(stage))
	{
		for (let i = 0; i < states.length; i++)
		{
			await new Promise((resolve, reject) =>
			{
				const args = [__filename];
				if (app.commandLine.hasSwitch('no-sandbox')) args.unshift('--no-sandbox');
				if (source) args.push('--source');
				const child = spawn(process.execPath, args, {stdio: 'inherit', env: {...process.env,
					DRAWIO_LAYERS_TEST_STAGE: String(i), DRAWIO_LAYERS_TEST_PROFILE: profile}});
				child.on('error', reject);
				child.on('exit', code => code === 0 ? resolve() : reject(new Error('Restart ' + i + ' exited ' + code)));
			});
		}
		console.log('PASS layer window persistence across Desktop restarts (' + (source ? 'source' : 'bundled') + ')');
		app.exit(0);
		return;
	}

	await import(pathToFileURL(path.join(root, 'src/main/electron.js')));
	const win = await firstWindow;
	const js = code => win.webContents.executeJavaScript(code);
	let ready = false;
	for (let i = 0; i < 200 && !ready; i++)
	{
		ready = await js(`typeof Draw !== 'undefined' && (() => {
			if (!window.layersTestRegistered) {
				window.layersTestRegistered = true;
				Draw.loadPlugin(ui => { window.testUi = ui; });
			}
			return !!window.testUi && testUi.getCurrentFile() != null;
		})()`);
		if (!ready) await pause(100);
	}
	assert(ready, 'Desktop initialized with a diagram');
	if (stage >= 3)
	{
		if (source) await js(fs.readFileSync(path.join(root, 'drawio/src/main/webapp/plugins/hierarchy-viewer.js'), 'utf8'));
		for (let i = 0; i < 100 && !await js('!!testUi.hierarchyViewer'); i++) await pause(100);
	}
	assert.equal(await js('!!testUi.hierarchyViewer'), stage >= 3, 'configured plugin loaded');
	const visible = '!!testUi.actions.layersWindow && testUi.actions.layersWindow.window.isVisible()';
	const saved = 'JSON.parse(localStorage.getItem(mxSettings.key)).windowStates.layers.visible';
	assert.equal(await js(visible), states[stage] === true, 'previous visibility restored for a single-layer diagram');
	if (stage > 0) assert.equal(await js(saved), states[stage], 'startup preserves saved visibility');

	await js(`window.layersTestData = '<mxGraphModel><root><mxCell id="0"/>' +
		'<mxCell id="1" parent="0"/><mxCell id="2" value="Second" parent="0"/>' +
		'<mxCell id="3" value="Object" vertex="1" parent="1">' +
		'<mxGeometry x="20" y="20" width="80" height="40" as="geometry"/>' +
		'</mxCell></root></mxGraphModel>';
		testUi.fileLoaded(new LocalFile(testUi, layersTestData, 'layers-test.drawio'));`);
	const expected = states[stage] !== false;
	assert.equal(await js(visible), expected, 'multiple layers respect saved visibility; fresh settings auto-open');
	await js('testUi.restoreVisibleWindows(); testUi.restoreVisibleWindows();');
	assert.equal(await js(visible), expected, 'repeated restore does not toggle windows');
	await js('testUi.fileLoaded(null, true);');
	assert.equal(await js(visible), false, 'windows hide while no diagram is open');
	assert.equal(await js(saved), expected, 'temporary hiding does not overwrite saved visibility');
	await js("testUi.fileLoaded(new LocalFile(testUi, layersTestData, 'layers-test.drawio'));");
	assert.equal(await js(visible), expected, 'reopening a file restores visibility');
	if (stage >= 3 && expected)
		assert.equal(await js('document.querySelector(".geHierarchyLabel").textContent'), 'Object', 'restored window renders the object tree');

	if (stage + 1 < states.length)
	{
		await js('if (!testUi.actions.layersWindow) testUi.actions.get("layers").funct();');
		await js('testUi.actions.layersWindow.window.setVisible(' + !states[stage + 1] + '); testUi.actions.get("layers").funct();');
		assert.equal(await js(saved), states[stage + 1], 'explicit toggle saves the next startup state');
		await js('mxSettings.setPlugins(' + JSON.stringify(stage + 1 >= 3 ? ['plugins/hierarchy-viewer.js'] : []) + '); mxSettings.save();');
	}
	assert.deepEqual(errors, [], 'no renderer errors');
	await win.webContents.session.flushStorageData();
	console.log('PASS restart ' + stage + ': saved=' + states[stage] + ', hierarchy=' + (stage >= 3));
	app.exit(0);
})().catch(err => { console.error(err, errors); app.exit(1); });

setTimeout(() => { console.error('Layer window GUI test timeout'); app.exit(2); }, 120000);
