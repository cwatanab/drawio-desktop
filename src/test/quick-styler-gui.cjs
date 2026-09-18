// Run with Electron, not node --test. Requires a display (or Xvfb).
const {app} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const root = path.resolve(__dirname, '../..');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-styler-test-')));
app.commandLine.appendSwitch('disable-gpu');
process.env.DRAWIO_DISABLE_UPDATE = 'true';
delete process.env.DRAWIO_ENV;
process.argv = [process.argv[0], root];
const errors = [];
const firstWindow = new Promise(resolve => app.once('browser-window-created', (_event, win) =>
{
	win.webContents.setUserAgent(win.webContents.getUserAgent() + ' draw.io/' + require('../../package.json').version);
	win.webContents.session.webRequest.onBeforeRequest({urls: ['http://*/*', 'https://*/*']},
		(_details, callback) => callback({cancel: true}));
	win.webContents.on('console-message', details =>
	{
		if (details.level === 'error' || details.message.startsWith('Plugin Error:')) errors.push(details.message);
	});
	resolve(win);
}));

(async () =>
{
	await import(pathToFileURL(path.join(root, 'src/main/electron.js')));
	const win = await firstWindow;
	const js = code => win.webContents.executeJavaScript(code);
	let ready = false;
	for (let i = 0; i < 200 && !ready; i++)
	{
		ready = await js(`typeof Draw !== 'undefined' && (() => {
			if (!window.stylerTestRegistered) {
				window.stylerTestRegistered = true;
				Draw.loadPlugin(ui => { window.testUi = ui; window.graph = ui.editor.graph; });
			}
			return !!window.testUi;
		})()`);
		if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
	}
	assert(ready, 'Desktop initialized');
	await js(fs.readFileSync(path.join(root, 'drawio/src/main/webapp/plugins/quick-styler.js'), 'utf8'));
	let checks = 0;
	const check = async (code, expected, label) => { assert.deepEqual(await js(code), expected, label); checks++; };
	await js(`
		window.a = graph.insertVertex(graph.getDefaultParent(), null, 'A', 20, 20, 80, 40);
		window.b = graph.insertVertex(graph.getDefaultParent(), null, 'B', 140, 20, 80, 40);
		window.menuItem = key => {
			const find = parent => {
				for (const row of parent.tbody.rows) {
					if (row.dataset.quickStyler === key) return row;
					if (row.tbody) { const found = find(row); if (found) return found; }
				}
			};
			return find(graph.popupMenuHandler);
		};
		window.openMenu = () => {
			graph.popupMenuHandler.hideMenu();
			graph.popupMenuHandler.popup(200, 100, a, new MouseEvent('contextmenu'));
		};
		window.press = (element, key) => element.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
		window.activate = key => press(menuItem(key), 'Enter');
		window.reset = () => {
			graph.setEnabled(true); graph.setCellsEditable(true);
			graph.model.setStyle(a, ''); graph.model.setStyle(b, '');
			graph.setSelectionCells([a, b]); testUi.editor.undoManager.clear(); openMenu();
		};
		reset();
	`);
	await check(`Array.from(menuItem('properties').tbody.rows).map(row => row.dataset.quickStyler || 'separator')`, [
		'autosize', 'aspect', 'separator',
		'noLabel', 'movableLabel', 'editable', 'separator',
		'container', 'expand', 'recursiveResize', 'collapsible', 'separator',
		'snapToPoint', 'constraintPoints', 'allowArrows', 'connectable', 'separator',
		'movable', 'resizable', 'rotatable', 'cloneable', 'deletable'
	], '18 properties flattened and grouped by dividers');
	for (const [key, initial, value, restored] of [
		['expand', true, '0', '1'], ['autosize', false, '1', '0'], ['aspect', false, 'fixed', '0'],
		['resizable', false, '0', '1'], ['movable', false, '0', '1'], ['container', false, '1', '0'],
		['noLabel', false, '1', '0'], ['snapToPoint', false, '1', '0'],
		['allowArrows', false, '0', '1'], ['connectable', false, '0', '1'],
		['rotatable', false, '0', '1'], ['cloneable', false, '0', '1'], ['deletable', false, '0', '1'],
		['editable', false, '0', '1'], ['movableLabel', false, '1', '0'],
		['collapsible', false, '1', '0'], ['recursiveResize', true, '0', '1']
	])
	{
		await js('reset();');
		await check(`menuItem('${key}').getAttribute('aria-checked')`, String(initial), key + ' default');
		await js(`activate('${key}');`);
		await check(`[a,b].map(cell => String(graph.getCurrentCellStyle(cell)['${key}']))`, [value, value], key + ' applies to both');
		await check('testUi.editor.undoManager.history.length', 1, key + ' one Undo');
		await js('testUi.editor.undoManager.undo();');
		await check('[a.style,b.style]', ['', ''], key + ' Undo restores unspecified values');
		await js('testUi.editor.undoManager.redo(); openMenu();');
		await check(`menuItem('${key}').getAttribute('aria-checked')`, String(!initial), key + ' Redo');
		await js(`activate('${key}');`);
		await check(`[a,b].map(cell => String(graph.getCurrentCellStyle(cell)['${key}']))`, [restored, restored], key + ' can be toggled back');
	}
	await js(`reset(); graph.model.setStyle(a, 'editable=0;'); openMenu();`);
	await check(`menuItem('editable').getAttribute('aria-checked')`, 'mixed', 'mixed label editing');
	await check(`menuItem('container').getAttribute('aria-disabled')`, 'true', 'label editing restriction still blocks other styles');
	await js(`activate('editable'); openMenu();`);
	await check('[graph.isCellEditable(a), graph.isCellEditable(b)]', [false, false], 'mixed editing toggles prohibition on');
	await js(`activate('editable');`);
	await check('[graph.isCellEditable(a), graph.isCellEditable(b)]', [true, true], 'label editing can be restored');
	await js(`reset(); graph.getStylesheet().putCellStyle('stylerInherited', {editable:'0',collapsible:'1',recursiveResize:'0'});
		graph.model.setStyle(a, 'stylerInherited'); graph.setSelectionCell(a); openMenu();`);
	await check(`['editable','collapsible','recursiveResize'].map(key => menuItem(key).getAttribute('aria-checked'))`,
		['true', 'true', 'false'], 'inherited values');
	await js(`activate('editable');`);
	await check('graph.isCellEditable(a)', true, 'explicit value overrides inherited prohibition');
	await js(`reset(); graph.model.setStyle(a, 'swimlane;'); graph.setSelectionCell(a); openMenu();`);
	await check(`menuItem('collapsible').getAttribute('aria-checked')`, 'true', 'swimlane folding default');
	await js(`activate('collapsible');`);
	await check('graph.isCellFoldable(a)', false, 'folding can be disabled for a swimlane');
	for (const setup of [
		`graph.setEnabled(false);`, `graph.setCellsEditable(false);`,
		`graph.model.setStyle(a, 'locked=1;');`, `graph.model.setStyle(a, 'part=1;');`,
		`graph.model.setStyle(graph.getDefaultParent(), 'locked=1;');`,
		`graph.model.setStyle(graph.getDefaultParent(), 'lockedGroup=1;');`,
		`graph.setSelectionCells([a, graph.insertEdge(graph.getDefaultParent(), null, '', a, b)]);`
	])
	{
		await js(`reset(); ${setup} openMenu();`);
		await check(`menuItem('editable').getAttribute('aria-disabled')`, 'true', 'editing toggle respects ' + setup);
		await js(`graph.model.setStyle(graph.getDefaultParent(), '');`);
	}
	await js(`reset(); window.expectedErrors = []; testUi.handleError = error => expectedErrors.push(error.message);
		graph.setSelectionCell(b); activate('editable');`);
	await check('expectedErrors.length', 1, 'stale selection is rejected');
	await check('testUi.editor.undoManager.history.length', 0, 'rejected change adds no Undo');
	await js(`reset(); graph.popupMenuHandler.hideMenu(); graph.container.dispatchEvent(
		new KeyboardEvent('keydown', {key:'F10',shiftKey:true,bubbles:true,cancelable:true}));`);
	await check('document.activeElement.dataset.quickStyler', 'properties', 'Shift+F10 focuses properties');
	for (const [key, expected] of [
		['ArrowRight','autosize'], ['End','deletable'], ['Home','autosize'],
		['ArrowUp','deletable'], ['ArrowDown','autosize'],
		['ArrowDown','aspect'], ['ArrowDown','noLabel'], ['ArrowDown','movableLabel'],
		['ArrowDown','editable'], ['ArrowDown','container'], ['ArrowDown','expand'],
		['ArrowDown','recursiveResize'], ['ArrowDown','collapsible'],
		['ArrowDown','snapToPoint'], ['ArrowDown','constraintPoints'],
		['ArrowRight','points-all'], ['ArrowLeft','constraintPoints'],
		['ArrowRight','points-all'], ['ArrowDown','points-h']
	])
	{
		await js(`press(document.activeElement, '${key}');`);
		await check('document.activeElement.dataset.quickStyler', expected, 'keyboard navigation ' + expected);
	}
	await js(`press(document.activeElement, 'Enter');`);
	await check('[a,b].map(cell => graph.getCurrentCellStyle(cell).points)',
		['[[0,0.5],[1,0.5]]', '[[0,0.5],[1,0.5]]'], 'nested connection preset applies to both');
	assert.deepEqual(errors, [], 'no renderer errors');
	console.log('PASS ' + checks + ' Quick Styler checks');
	app.exit(0);
})().catch(error => { console.error(error, errors); app.exit(1); });

setTimeout(() => { console.error('Quick Styler test timeout'); app.exit(2); }, 60000);
