// npm run test:plugins-gui -- --performance
const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({win, js: evaluate, fs, pause}) =>
{
	let checks = 0;
	const js = code => evaluate(code + '\nvoid 0;');
	const check = async (code, expected, label) =>
	{
		assert.deepEqual(await evaluate(code), expected, label);
		checks++;
	};
	const load = name => js(fs.readFileSync(path.join(__dirname,
		'../../drawio/src/main/webapp/plugins/' + name + '.js'), 'utf8'));
	win.setSize(1440, 1000);
	await js(`
		window.cells = [];
		graph.model.beginUpdate();
		try {
			for (let i = 0; i < 500; i++) cells.push(graph.insertVertex(
				graph.getDefaultParent(), null, 'Cell ' + i, (i % 20) * 100, Math.floor(i / 20) * 60, 80, 40));
		} finally { graph.model.endUpdate(); }
		window.a = cells[0]; window.b = cells[1];
		window.edge = graph.insertEdge(graph.getDefaultParent(), null, '', a, b);
		window.listenerCounts = () => [graph.model, graph, testUi, graph.selectionModel].map(
			source => (source.eventListeners || []).filter(value => typeof value === 'function' &&
				['scheduleRefresh', 'updateLayerDot'].includes(value.name)).length);
	`);
	await load('hierarchy-viewer');
	await js(`
		testUi.actions.get('layers').funct();
		window.layers = testUi.actions.layersWindow;
		window.row = cell => layers.window.div.querySelector('[data-cell-id="' + cell.id + '"]');
		window.list = row(a).parentNode;
		window.mutations = [];
		window.observer = new MutationObserver(records => mutations.push(...records));
		observer.observe(list, {childList:true});
		window.rebuilds = () => mutations.filter(record => record.removedNodes.length > 0).length;
		window.renameBurst = prefix => {
			mutations.length = 0;
			for (let i = 0; i < 20; i++) graph.model.setValue(a, prefix + i);
		};
		renameBurst('Visible ');
	`);
	await check('listenerCounts()', [1, 1, 1, 1], 'each tree listener is installed once');
	await pause(50);
	await check('rebuilds()', 1, '20 model changes produce one tree rebuild');
	await check('row(a).querySelector(".geHierarchyLabel").textContent', 'Visible 19', 'latest label rendered');
	await js(`
		list.scrollTop = 100;
		layers.window.setVisible(false);
		renameBurst('Hidden ');
		graph.setSelectionCell(b);
	`);
	await pause(50);
	await check('rebuilds()', 0, 'hidden tree does not rebuild');
	await js('layers.window.setVisible(true);');
	await pause(20);
	await check('rebuilds()', 1, 'showing the dirty tree rebuilds once');
	await check('row(a).querySelector(".geHierarchyLabel").textContent', 'Hidden 19', 'hidden changes appear on show');
	await check('list.scrollTop', 100, 'scroll position survives rebuild');
	await check('row(b).getAttribute("aria-selected")', 'true', 'hidden selection appears on show');
	await js(`
		window.selectionRemovals = 0;
		window.removeAttribute = Element.prototype.removeAttribute;
		Element.prototype.removeAttribute = function(name) {
			if (name === 'aria-selected' && this.classList.contains('geHierarchyRow')) selectionRemovals++;
			return removeAttribute.apply(this, arguments);
		};
		graph.setSelectionCell(a);
		Element.prototype.removeAttribute = removeAttribute;
	`);
	await check('selectionRemovals', 1, 'selection only clears the previous selected row');
	await check('[row(a).getAttribute("aria-selected"), row(b).getAttribute("aria-selected")]',
		['true', null], 'selection highlight follows the canvas');
	await js(`
		window.dropClears = 0;
		window.removeClass = DOMTokenList.prototype.remove;
		DOMTokenList.prototype.remove = function(...names) {
			if (names.includes('geHierarchyBefore')) dropClears++;
			return removeClass.apply(this, names);
		};
		window.transfer = new DataTransfer();
		window.drag = (element, type) => element.dispatchEvent(new DragEvent(type, {
			dataTransfer:transfer, bubbles:true, cancelable:true,
			clientY:element.getBoundingClientRect().top + 1
		}));
		list.scrollTop = list.scrollHeight;
		drag(row(a).querySelector('[data-hierarchy-action="drag"]'), 'dragstart');
		drag(row(b), 'dragover');
		drag(row(cells[2]), 'dragover');
		DOMTokenList.prototype.remove = removeClass;
	`);
	await check('dropClears', 1, 'dragover only clears the previously marked row');
	await check('list.querySelectorAll(".geHierarchyBefore").length', 1, 'one drop target is marked');
	await js(`
		testUi.editor.undoManager.clear();
		drag(row(cells[2]), 'drop');
	`);
	await pause(30);
	await check('a.parent.getIndex(a) === a.parent.getIndex(cells[2]) + 1', true, 'drop reorders within its parent');
	await check('testUi.editor.undoManager.history.length', 1, 'drop remains one Undo');
	await js(`
		testUi.editor.undoManager.undo();
		graph.model.setValue(a, 'Pending at destroy');
		testUi.hierarchyViewer.destroy();
		mutations.length = 0;
	`);
	await pause(30);
	await check('listenerCounts()', [0, 0, 0, 0], 'destroy removes every tree listener');
	await check('testUi.actions.layersWindow', null, 'destroy releases the custom window');
	await check('rebuilds()', 0, 'destroy cancels the pending rebuild');
	await load('hierarchy-viewer');
	await load('hierarchy-viewer');
	await js('testUi.actions.get("layers").funct();');
	await check('document.querySelectorAll("[data-cell-id=\\"" + a.id + "\\"]").length', 1, 'reload creates one tree');
	await js('testUi.hierarchyViewer.destroy(); observer.disconnect();');

	await load('handle-scaler');
	await js(`
		window.refreshCount = 0;
		window.originalRefresh = graph.selectionCellsHandler.refresh;
		graph.selectionCellsHandler.refresh = function() {
			refreshCount++;
			return originalRefresh.apply(this, arguments);
		};
		window.pointImage = mxConstraintHandler.prototype.pointImage;
		graph.setSelectionCell(b);
	`);
	await check('refreshCount', 1, 'selection uses just the native handle refresh');
	await check('mxConstraintHandler.prototype.pointImage === pointImage', true, 'selection reuses the point image');
	await js('graph.view.scaleAndTranslate(graph.view.scale, 10, 10);');
	await check('mxConstraintHandler.prototype.pointImage === pointImage', true, 'pan with unchanged scale reuses images');
	await js('graph.setSelectionCell(edge); graph.view.setScale(2);');
	await check('[mxConstants.HANDLE_SIZE, mxConstraintHandler.prototype.pointImage.width]', [14, 7], 'zoom updates vertex and point sizes');
	await check('graph.selectionCellsHandler.getHandler(edge).bends.map(bend => bend.bounds.width)', [37, 37], 'zoom updates both edge endpoints');
	await js(`
		window.handler = graph.selectionCellsHandler.getHandler(edge);
		window.redraws = [0, 0];
		handler.bends.forEach((bend, i) => {
			const original = bend.redraw;
			bend.redraw = function() { redraws[i]++; return original.apply(this, arguments); };
		});
		handler.redrawHandles();
	`);
	await check('redraws', [1, 1], 'unchanged edge sizes do not trigger duplicate painting');
	await load('handle-scaler');
	await js('refreshCount = 0; graph.setSelectionCell(a);');
	await check('refreshCount', 1, 'reloading does not add a selection listener');
	await js('graph.selectionCellsHandler.refresh = originalRefresh;');
	console.log('PASS ' + checks + ' plugin performance and lifecycle checks (500 cells)');
};
