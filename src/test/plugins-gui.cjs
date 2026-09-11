// Runs the real Desktop entry point with an isolated profile. Requires a display.
const {app} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const source = process.argv.includes('--source');
const performance = process.argv.includes('--performance');
const stage = Number(process.env.DRAWIO_PLUGIN_TEST_STAGE);
const configurations = [[], ['hierarchy'], ['quickstyler'], ['hierarchy','quickstyler'], [], ['quickstyler','hierarchy']];
const files = {hierarchy:'plugins/hierarchy-viewer.js',quickstyler:'plugins/quick-styler.js'};
const profile = Number.isNaN(stage) ? fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-plugins-profile-')) : process.env.DRAWIO_PLUGIN_TEST_PROFILE;
app.setPath('userData', Number.isNaN(stage) ? fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-plugins-runner-')) : profile);
app.commandLine.appendSwitch('disable-gpu');
process.env.DRAWIO_DISABLE_UPDATE = 'true';
delete process.env.DRAWIO_ENV;
process.argv = [process.argv[0], root];
const errors = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const firstWindow = new Promise(resolve => app.once('browser-window-created', (_event, win) =>
{
	// A script entry point lacks the app token used by Desktop's bootstrap.
	win.webContents.setUserAgent(win.webContents.getUserAgent() + ' draw.io/' + require('../../package.json').version);
	// The complete workflow must work with all remote requests blocked.
	win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (_details, callback) => callback({cancel:true}));
	win.webContents.on('console-message', details =>
	{
		if (details.level === 'error' || details.message.startsWith('Plugin Error:')) errors.push(details.message);
	});
	win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
	resolve(win);
}));

(async () =>
{
	if (Number.isNaN(stage) && !performance)
	{
		// Separate processes, one profile: verifies real restarts, not a test-only loader.
		for (let i = 0; i < configurations.length; i++)
		{
			await new Promise((resolve, reject) =>
			{
				const args = [__filename];
				if (app.commandLine.hasSwitch('no-sandbox')) args.unshift('--no-sandbox');
				if (source) args.push('--source');
				const child = spawn(process.execPath, args, {stdio:'inherit',env:{...process.env,
					DRAWIO_PLUGIN_TEST_STAGE:String(i),DRAWIO_PLUGIN_TEST_PROFILE:profile}});
				child.on('error', reject);
				child.on('exit', code => code === 0 ? resolve() : reject(new Error('Plugin test stage ' + i + ' exited ' + code)));
			});
		}
		console.log('PASS all plugin configurations across Desktop restarts');
		app.exit(0);
		return;
	}
	await import(pathToFileURL(path.join(root, 'src/main/electron.js')));
	const win = await firstWindow;
	const js = code => win.webContents.executeJavaScript(code).catch(err =>
	{
		throw new Error(err.message + '\nRenderer check: ' + code.slice(0,240));
	});
	async function ready()
	{
		for (let i = 0; i < 200; i++)
		{
			const loaded = await js('typeof Draw !== "undefined" && typeof App !== "undefined" && typeof EditorUi !== "undefined"');
			if (loaded)
			{
				await js('if (!window.pluginTestRegistered) { window.pluginTestRegistered=true; Draw.loadPlugin(function(ui) { window.testUi=ui; window.graph=ui.editor.graph; }); } void 0;');
				if (await js('!!window.testUi')) return;
			}
			await pause(100);
		}
		throw new Error('Desktop initialization timed out');
	}
	await ready();
	if (performance)
	{
		await require('./plugins-performance-gui-driver.cjs')({win, js, fs, pause});
		assert.deepEqual(errors, [], 'no renderer errors');
		app.exit(0);
		return;
	}
	assert.equal(await js('mxIsElectron && App.main.toString().includes("Skipped plugins")'),true,'actual Desktop loader is active');
	win.setSize(1440, 1000);
	const expected = configurations[stage];
	const flags = [expected.includes('hierarchy'),expected.includes('quickstyler')];
	for (let i=0;i<100;i++)
	{
		const actual=await js('[!!testUi.hierarchyViewer,!!testUi.quickStyler]');
		if (JSON.stringify(actual)===JSON.stringify(flags)) break;
		await pause(100);
	}
	assert.deepEqual(await js('[!!testUi.hierarchyViewer,!!testUi.quickStyler]'), flags, 'configured plugins load in normal Desktop');
	assert.equal(await js('document.querySelectorAll("[data-hierarchy-tab=hierarchy]").length'), flags[0]?1:0, 'exactly one dock when enabled');
	assert.equal(await js('App.pluginRegistry.hierarchy'), files.hierarchy, 'hierarchy registry in bundled App');
	assert.equal(await js('App.pluginRegistry.quickstyler'), files.quickstyler, 'styler registry in bundled App');
	assert.equal(await js('App.publicPlugin.includes("hierarchy") && App.publicPlugin.includes("quickstyler")'), true, 'both plugins are selectable');
	if(stage===0)
	{
		await js('testUi.actions.get("plugins").funct();Array.from(testUi.dialog.container.querySelectorAll("button")).find(b=>b.textContent===mxResources.get("add")).click();');
		assert.equal(await js('Array.from(testUi.dialog.container.querySelector("select").options).some(o=>o.value==="hierarchy")'),true,'hierarchy appears in the Desktop built-in plugin picker');
		assert.equal(await js('Array.from(testUi.dialog.container.querySelector("select").options).some(o=>o.value==="quickstyler")'),true,'styler appears in the Desktop built-in plugin picker');
		await js('testUi.hideDialog();testUi.hideDialog();');
	}
	await js('var smokeCell=graph.insertVertex(graph.getDefaultParent(),null,"Smoke",20,20,80,40);graph.setSelectionCell(smokeCell);graph.popupMenuHandler.popup(400,100,smokeCell,new MouseEvent("contextmenu"));void 0;');
	assert.equal(await js('graph.popupMenuHandler.tbody.querySelectorAll("[data-quick-styler]").length'), flags[1]?2:0, 'original popup gains exactly two top-level entries');
	await js('graph.popupMenuHandler.hideMenu();');
	if (stage===0)
		await js('localStorage.setItem("drawio-quick-styler-styles",JSON.stringify([{name:"Restart check",style:{fillColor:"#abcdef"}}]));localStorage.setItem("drawio-hierarchy-viewer-state","legacy-window-state");');
	else
	{
		assert.equal(await js('JSON.parse(localStorage.getItem("drawio-quick-styler-styles"))[0].name'), stage<4?'Restart check':'Test preset', 'saved styles survive restart and disabling');
		assert.equal(await js('localStorage.getItem("drawio-hierarchy-viewer-state")'), 'legacy-window-state', 'legacy floating state is untouched');
	}
	if (stage===5)
		assert.equal(await js('document.querySelector("[data-hierarchy-tab=hierarchy]").getAttribute("aria-selected")'), 'true', 'last tab survives disable/re-enable and reversed loading order');
	console.log('PASS Desktop restart ' + stage + ': ' + (expected.join(' + ') || 'both disabled'));
	if (stage===3 && source)
	{
		await js('testUi.getCurrentFile().setModified(false);');
		const url = new URL(win.webContents.getURL());
		url.searchParams.set('dev', '1');
		await win.loadURL(url.href);
		await ready();
		assert.equal(await js('urlParams.dev'),'1','source mode navigation completed');
		assert.equal(await js('mxIsElectron && App.main.toString().includes("Skipped plugins")'),true,'source Desktop loader is active');
		assert.equal(await js('!!testUi.hierarchyViewer || !!testUi.quickStyler'), false, 'dev mode skips configured plugins');
		for (const file of ['hierarchy-viewer.js', 'quick-styler.js'])
			await js(fs.readFileSync(path.join(root, 'drawio/src/main/webapp/plugins', file), 'utf8'));
	}
	if (stage===3)
	{
		console.log('Testing ' + (source ? 'source (explicit test load)' : 'bundled Desktop'));
		await require('./plugins-gui-driver.cjs')({win, js, fs, pause});
	}
	if (stage+1<configurations.length)
		await js('mxSettings.setPlugins('+JSON.stringify(configurations[stage+1].map(id=>files[id]))+');mxSettings.save();void 0;');
	if (stage===5)
	{
		const baseUrl=win.webContents.getURL();
		for (const [key,value] of [['ui','sketch'],['chrome','0']])
		{
			await js('testUi.getCurrentFile().setModified(false);');
			const url=new URL(baseUrl);url.searchParams.set(key,value);
			await win.loadURL(url.href);
			await ready();
			for(let i=0;i<100 && !await js('!!testUi.hierarchyViewer');i++)await pause(100);
			assert.equal(await js(key==='ui'?'Editor.currentTheme==="sketch"':'testUi.editor.chromeless'),true,'requested unsupported mode is active');
			assert.equal(await js('document.querySelectorAll("[data-hierarchy-tab=hierarchy]").length'),0,'unsupported UI does not gain a dock');
			assert.equal(await js('testUi.actions.get("toggleHierarchyViewer").isEnabled()'),false,'unsupported UI action is disabled');
			assert.equal(await js('testUi.actions.get("toggleHierarchyViewer").label.includes("通常の右サイドバー")'),true,'unsupported UI explains why');
			console.log('PASS unsupported UI: '+key+'='+value);
		}
	}
	assert.deepEqual(errors, [], 'no renderer errors');
	await win.webContents.session.flushStorageData();
	app.exit(0);
})().catch(err => { console.error(err, errors); app.exit(1); });

setTimeout(() => { console.error('Plugin GUI test timeout'); app.exit(2); }, 180000);
