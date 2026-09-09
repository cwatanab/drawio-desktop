// Run with Electron, not node --test. Requires a display (or Xvfb).
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../../drawio/src/main/webapp');
const bundled = process.argv.includes('--bundled');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-selection-profile-')));
app.commandLine.appendSwitch('disable-gpu');

const server = http.createServer((req, res) =>
{
	const route = new URL(req.url, 'http://localhost').pathname;

	if (route === '/viewer-test.html')
	{
		const file = new URL(req.url, 'http://localhost').searchParams.has('static') ?
			'viewer-static.min.js' : 'viewer.min.js';
		res.setHeader('Content-Type', 'text/html');
		res.end('<!doctype html><html><head><meta charset="utf-8">' +
			'<script>window.mxBasePath="mxgraph";window.GRAPH_IMAGE_PATH="img";' +
			'window.STENCIL_PATH="stencils";window.STYLE_PATH="styles";' +
			'window.mxLoadResources=false;window.mxLoadStylesheets=false;</script>' +
			'<script src="js/' + file + '"></script></head><body>' +
			'<div id="graph" style="width:1000px;height:800px"></div></body></html>');
		return;
	}

	if (route === '/selection-test.html')
	{
		res.setHeader('Content-Type', 'text/html');
		res.end('<!doctype html><html><head><meta charset="utf-8">' +
			'<link rel="stylesheet" href="styles/grapheditor.css">' +
			'<script src="js/bootstrap.js"></script></head><body style="margin:0">' +
			'<div id="graph" style="position:absolute;inset:0;overflow:hidden"></div></body></html>');
		return;
	}

	const file = path.resolve(root, '.' + decodeURIComponent(route));

	if (!file.startsWith(root + path.sep))
	{
		res.writeHead(403).end();
		return;
	}

	const types = {'.js': 'text/javascript', '.css': 'text/css', '.xml': 'text/xml',
		'.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png'};
	fs.readFile(file, (err, data) =>
	{
		if (err)
		{
			res.writeHead(404).end();
		}
		else
		{
			res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
			res.end(data);
		}
	});
});

(async () =>
{
	await app.whenReady();
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const win = new BrowserWindow({width: 1600, height: 1200, show: true,
		webPreferences: {nodeIntegration: false, contextIsolation: true}});
	const errors = [];
	win.webContents.on('console-message', details =>
	{
		if (details.level === 'error') errors.push(details.message);
	});
	win.webContents.on('render-process-gone', (_event, details) => errors.push(details.reason));
	if (process.argv.includes('--viewer-only'))
	{
		const fixture = fs.readFileSync(path.join(__dirname, '../../docs/selection/reproduction.drawio'), 'utf8');
		for (const suffix of ['', '?static=1'])
		{
			await win.loadURL('http://127.0.0.1:' + server.address().port + '/viewer-test.html' + suffix);
			const rendered = await win.webContents.executeJavaScript(
				"var graph=new Graph(document.getElementById('graph'));graph.setEnabled(false);" +
				'var fixture=mxUtils.parseXml(' + JSON.stringify(fixture) + ');' +
				"var doc=mxUtils.parseXml(mxUtils.getXml(fixture.getElementsByTagName('mxGraphModel')[8]));" +
				'new mxCodec(doc).decode(doc.documentElement,graph.model);graph.refresh();' +
				"var state=graph.view.getState(graph.model.getCell('B'));" +
				'var rendered=state!=null&&state.shape.node!=null&&state.width>0;' +
				'graph.destroy();rendered;');
			assert(rendered, 'viewer renders nested groups');
		}
		assert.deepEqual(errors, [], 'no viewer renderer errors');
		console.log('PASS both viewer bundles render nested groups');
		server.close();
		app.quit();
		return;
	}
	await win.loadURL('http://127.0.0.1:' + server.address().port +
		'/selection-test.html?dev=' + (bundled ? 0 : 1) +
		'&lang=en&offline=1&local=1&gapi=0&db=0&od=0&gh=0&gl=0');

	// The bundled bootstrap loads app.min.js asynchronously.
	let ready = false;
	for (let i = 0; i < 100 && !ready; i++)
	{
		ready = await win.webContents.executeJavaScript('typeof Graph === "function" && typeof mxGraph === "function"');
		if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
	}
	assert(ready, 'editor scripts loaded');
	win.webContents.focus();
	await win.webContents.executeJavaScript(
		"window.graph = new Graph(document.getElementById('graph'));" +
		"graph.setEnabled(true);window.rubberband = new mxRubberband(graph);void 0;");
	console.log('Testing ' + (bundled ? 'bundled' : 'source') + ' editor');
	await require('./selection-gui-driver.cjs')({win, fs});
	assert.deepEqual(errors, [], 'no renderer errors');
	server.close();
	app.quit();
})().catch(err =>
{
	console.error(err);
	server.close();
	app.exit(1);
});

setTimeout(() => { console.error('GUI test timeout'); app.exit(2); }, 120000);
