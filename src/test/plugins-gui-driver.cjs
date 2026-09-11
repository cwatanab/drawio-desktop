const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({win, js, fs, pause}) =>
{
	let checks = 0;
	const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
	const check = async (expression, expected, label) => eq(await js(expression), expected, label);
	const settle = () => pause(40);
	const send = (type, x, y, extra = {}) => win.webContents.sendInputEvent(
		{type, x: Math.round(x), y: Math.round(y), ...extra});
	const click = async (expression, modifiers = []) =>
	{
		const box = await js(`(() => {const e=${expression};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
		send('mouseMove', box.x, box.y);
		send('mouseDown', box.x, box.y, {button: 'left', clickCount: 1, modifiers});
		send('mouseUp', box.x, box.y, {button: 'left', clickCount: 1, modifiers});
		await settle();
	};
	const key = async (keyCode, modifiers = []) =>
	{
		win.webContents.sendInputEvent({type: 'keyDown', keyCode, modifiers});
		win.webContents.sendInputEvent({type: 'keyUp', keyCode, modifiers});
		await settle();
	};
	const selected = () => js('graph.getSelectionCells().map(c=>c.id).sort()');
	const xml = () => js('mxUtils.getXml(new mxCodec().encode(graph.model))');
	const undoSize = () => js('testUi.editor.undoManager.history.length');
	await js(`
		window.c = id => graph.model.getCell(id);
		window.row = id => document.querySelector('.geHierarchyRow[data-cell-id="'+id+'"]');
		window.button = (id,kind) => row(id).querySelector('[data-hierarchy-action="'+kind+'"]');
		window.treeTab = () => document.querySelector('[data-hierarchy-tab="hierarchy"]');
		window.formatTab = () => document.querySelector('[data-hierarchy-tab="format"]');
		window.modelXml = () => mxUtils.getXml(new mxCodec().encode(graph.model));
		window.pointer = (e,type) => e.dispatchEvent(new PointerEvent((mxClient.IS_POINTER?'pointer':'mouse')+type,{bubbles:true,button:0,pointerId:1,pointerType:'mouse'}));
		window.menuItem = key => {
			const find = parent => {for (const r of parent.tbody.rows) {if(r.dataset.quickStyler===key)return r;if(r.tbody){const found=find(r);if(found)return found;}}};
			return find(graph.popupMenuHandler);
		};
		window.openMenu = id => {graph.popupMenuHandler.hideMenu();graph.popupMenuHandler.popup(400,100,c(id),new MouseEvent('contextmenu',{button:2}));};
		window.activateItem = key => {const e=menuItem(key);pointer(e,'down');pointer(e,'up');};
		window.dragRow = (id,target,mode='inside',beforeDrop) => {
			const from=button(id,'drag'),to=row(target),rect=to.getBoundingClientRect(),data=new DataTransfer();
			from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));
			const args={bubbles:true,cancelable:true,dataTransfer:data,clientY:rect.top+rect.height*(mode==='before'?0.1:mode==='after'?0.9:0.5)};
			to.dispatchEvent(new DragEvent('dragover',args));
			if(beforeDrop)beforeDrop();
			to.dispatchEvent(new DragEvent('drop',args));
			from.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));
		};
		const empty='<mxGraphModel><root><mxCell id="0"/><mxCell id="L1" parent="0" value="Main layer"/></root></mxGraphModel>';
		testUi.fileLoaded(new LocalFile(testUi,'<mxfile><diagram id="p1" name="Main">'+empty+'</diagram><diagram id="p2" name="Other">'+empty+'</diagram></mxfile>','Plugin test.drawio',true),true);
		graph.model.beginUpdate();
		try {
			const layer=c('L1');
			const vertex=(parent,id,value,x,y,w=80,h=40,style='')=>graph.insertVertex(parent,id,value,x,y,w,h,style);
			const a=vertex(layer,'A','Rear',30,30);
			const b=vertex(layer,'B','Front',30,30);
			const group=vertex(layer,'G','Group',200,120,260,180,'group;selectParentFirst=1;');
			vertex(group,'C','Child',20,20);
			const nested=vertex(group,'N','Nested',130,90,110,70,'group;');
			vertex(nested,'D','Deep child',10,10);
			const locked=vertex(layer,'LG','Locked group',520,120,120,100,'group;lockedGroup=1;');
			vertex(locked,'LC','Locked child',10,10);
			const hidden=vertex(layer,'H','Hidden parent',30,360,160,90,'group;');
			vertex(hidden,'HC','Hidden child',10,10);graph.model.setVisible(hidden,false);
			vertex(layer,'S','Locked cell',250,360,80,40,'locked=1;');
			const data=mxUtils.createXmlDocument().createElement('UserObject');data.setAttribute('label','XML label');data.setAttribute('custom','keep');
			vertex(layer,'X',data,350,360);
			vertex(layer,'HTML','<b>Rich &amp; safe</b>',450,360,80,40,'html=1;');
			vertex(layer,'EMPTY','',550,360);
			graph.insertEdge(layer,'E','',a,b,'edgeStyle=orthogonalEdgeStyle;');
			const second=new mxCell('Second layer');second.id='L2';graph.model.add(graph.model.getRoot(),second);
			vertex(second,'Z','Second',650,30);
		} finally {graph.model.endUpdate();}
		window.pluginFixture=testUi.getFileData();
		window.resetFixture=()=>{graph.stopEditing(true);graph.popupMenuHandler.hideMenu();testUi.setFileData(pluginFixture);graph.clearSelection();graph.view.scaleAndTranslate(1,0,0);graph.refresh();testUi.editor.undoManager.clear();testUi.getCurrentFile().setModified(false);};
		resetFixture();void 0;
	`);
	await settle();
	const original = await xml();
	await check('testUi.format.container.parentNode===testUi.formatContainer', true, 'existing Format stays inside dock');
	await check('formatTab().getAttribute("aria-selected")', 'true', 'first enabled tab is Format');
	await check('testUi.format.container.offsetHeight>100', true, 'Format content has usable height');
	await click('treeTab()');
	await check('Array.from(document.querySelectorAll(".geHierarchyRow")).map(r=>r.dataset.cellId)',
		['L2','Z','L1','E','EMPTY','HTML','X','S','H','HC','LG','LC','G','N','D','C','B','A'], 'reverse recursive model order, including hidden cells');
	await check('row("HTML").querySelector(".geHierarchyLabel").textContent', 'Rich & safe', 'HTML label extracted as text');
	await check('row("EMPTY").querySelector(".geHierarchyLabel").textContent', '図形 EMPTY', 'unnamed vertex uses ID');
	await check('row("E").querySelector(".geHierarchyLabel").textContent', 'Rear → Front', 'unnamed edge uses terminals');
	await click('row("C").querySelector(".geHierarchyLabel")');
	eq(await selected(), ['C'], 'explicit child selection bypasses selectParentFirst');
	await click('row("D").querySelector(".geHierarchyLabel")', ['shift']);
	eq(await selected(), ['C','D'], 'Shift adds exact nested child');
	await click('row("C").querySelector(".geHierarchyLabel")', ['control']);
	eq(await selected(), ['D'], 'Ctrl toggles selection');
	await js('graph.setSelectionCells([c("A"),c("B")]);void 0;');
	await check('[row("A"),row("B")].every(r=>r.getAttribute("aria-selected")==="true")', true, 'all canvas selections reflected');
	await check('document.activeElement===row("C")', true, 'canvas selection does not steal tree focus');
	await click('row("LC").querySelector(".geHierarchyLabel")');
	eq(await selected(), ['LG'], 'locked child redirects to group');
	for (const id of ['H','HC','S'])
	{
		await click(`row('${id}').querySelector('.geHierarchyLabel')`);
		eq(await selected(), ['LG'], id + ' only focuses row');
	}
	await click('row("L2").querySelector(".geHierarchyLabel")');
	await check('graph.getDefaultParent().id', 'L2', 'layer click switches default parent');
	eq(await selected(), ['LG'], 'layer does not enter selection model');
	eq(await xml(), original, 'selection and tabs do not change model');
	eq(await undoSize(), 0, 'selection and tabs add no undo history');
	await check('testUi.getCurrentFile().isModified()', false, 'selection and tabs leave file clean');
	await check('button("HC","visibility").title.includes("親が非表示")', true, 'ancestor visibility is identified');
	await check('button("LC","rename").disabled', true, 'locked child cannot rename');
	await click('button("X","rename")');
	await js('row("X").querySelector("input").value="Changed XML";');
	await key('Enter');
	await check('[c("X").value.getAttribute("label"),c("X").value.getAttribute("custom")]', ['Changed XML','keep'], 'rename preserves XML attributes');
	eq(await undoSize(), 1, 'rename is one Undo');
	await js('testUi.editor.undoManager.undo();');
	await check('graph.convertValueToString(c("X"))', 'XML label', 'Undo restores label');
	await js('testUi.editor.undoManager.redo();');
	await check('graph.convertValueToString(c("X"))', 'Changed XML', 'Redo restores rename');
	await settle();
	await click('button("A","rename")');
	await js('row("A").querySelector("input").value="Cancel";');
	await key('Escape');
	await check('c("A").value', 'Rear', 'Escape cancels rename');
	await click('button("A","rename")');
	await js(`var input=row('A').querySelector('input');input.value='日本語';input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));`);
	await key('Enter');
	await check('!!row("A").querySelector("input")', true, 'IME Enter does not finish edit');
	await js(`row('A').querySelector('input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`);
	await key('Enter');
	await check('c("A").value', '日本語', 'Enter after composition commits');
	await click('button("B","rename")');
	await js('row("B").querySelector("input").value="Wrong page";');
	await click('Array.from(testUi.tabContainer.querySelectorAll(".geTab")).find(t=>t.title.startsWith("Other ("))');
	await check('testUi.currentPage.getId()', 'p2', 'native page tab changes page');
	await check('treeTab().getAttribute("aria-selected")', 'true', 'page switch keeps hierarchy tab');
	await js('testUi.selectPage(testUi.pages[0]);');
	await settle();
	await check('c("B").value', 'Front', 'page switch cancels inline rename');
	await click('button("HTML","rename")');
	await check('graph.isEditing()', true, 'rich label uses native editor');
	await js('graph.stopEditing(true);graph.setSelectionCells([c("G"),c("C")]);void 0;');
	await click('button("G","visibility")');
	await check('graph.model.isVisible(c("G"))', false, 'visibility changes model');
	eq(await selected(), [], 'hidden subtree removed from selection');
	await js('testUi.editor.undoManager.undo();');
	await check('graph.model.isVisible(c("G"))', true, 'Undo restores visibility');
	await js('testUi.editor.undoManager.redo();');
	await check('graph.model.isVisible(c("G"))', false, 'Redo hides subtree');
	await check('document.querySelectorAll(".geHierarchyTabs").length', 1, 'tabs survive model changes');
	await click('formatTab()');
	await check('testUi.format.container.children.length>0 && testUi.format.container.offsetHeight>100', true, 'Format redraw works after edits');
	await click('treeTab()');
	await js('resetFixture();');
	await settle();
	console.log('PASS ' + checks + ' hierarchy docking, selection and edit checks');

	await js(`window.absolute = id => {const s=graph.view.getState(c(id));return [s.x/graph.view.scale-graph.view.translate.x,s.y/graph.view.scale-graph.view.translate.y,s.width/graph.view.scale,s.height/graph.view.scale];};void 0;`);
	const beforeOrder = await xml();
	await js('dragRow("A","B","before");');
	await settle();
	await check('c("L1").children.slice(0,2).map(c=>c.id)', ['B','A'], 'move toward front uses removed-source siblings');
	await js('dragRow("A","B","after");');
	await settle();
	eq(await xml(), beforeOrder, 'move toward back restores original order and data');
	eq(await undoSize(), 2, 'each reorder is one Undo');
	await js('dragRow("A","B","after");');
	eq(await undoSize(), 2, 'no-op reorder adds no Undo');
	await js('resetFixture();');
	await settle();
	const crossOriginal = await xml();
	const childPosition = await js('absolute("C")');
	await js('dragRow("C","L2");');
	await settle();
	await check('c("C").parent.id', 'L2', 'drop layer center reparents');
	eq(await js('absolute("C")'), childPosition, 'group exit keeps absolute position');
	eq(await undoSize(), 1, 'cross-parent move is one Undo');
	await js('testUi.editor.undoManager.undo();');
	await settle();
	eq(await xml(), crossOriginal, 'cross-parent Undo restores complete model');
	await js('testUi.editor.undoManager.redo();');
	await settle();
	await js('dragRow("C","N");');
	await settle();
	await check('c("C").parent.id', 'N', 'drop existing nested group accepts child');
	eq(await js('absolute("C")'), childPosition, 'group entry keeps negative local coordinates');
	await check('c("C").geometry.x<0', true, 'negative coordinates are not clamped');
	await js('resetFixture();');
	await settle();
	for (const [from,to,mode] of [['G','D','inside'],['A','A','before'],['A','B','inside'],
		['L1','G','inside'],['E','L2','inside'],['LC','L2','inside'],['A','LG','inside'],['S','B','before']])
	{
		const unchanged = await xml(), history = await undoSize();
		await js(`dragRow('${from}','${to}','${mode}');`);
		await settle();
		eq(await xml(), unchanged, from + ' → ' + to + ' forbidden drop preserves model');
		eq(await undoSize(), history, from + ' → ' + to + ' forbidden drop preserves Undo');
	}
	await js(`graph.insertEdge(c('G'),'CE','',c('C'),c('D'),'edgeStyle=orthogonalEdgeStyle;');graph.refresh();testUi.editor.undoManager.clear();`);
	await settle();
	const connected = await xml(), positions = await js('[absolute("G"),absolute("C"),absolute("D")]');
	await js('dragRow("G","L2");');
	await settle();
	await check('c("G").parent.id', 'L2', 'group with nested children moves across layers');
	eq(await js('[absolute("G"),absolute("C"),absolute("D")]'), positions, 'group and descendants retain absolute bounds');
	await check('[c("CE").source.id,c("CE").target.id]', ['C','D'], 'connected edge terminals preserved');
	await js('testUi.editor.undoManager.undo();');
	await settle();
	eq(await xml(), connected, 'group move Undo preserves edge and model data');
	await js(`graph.setCellStyles('transparentBounds','1',[c('N')]);graph.refresh();testUi.editor.undoManager.clear();`);
	await settle();
	const transparent = await xml(), deepPosition = await js('absolute("D")');
	await js('dragRow("N","L2");');
	await settle();
	await check('c("N").parent.id', 'L2', 'transparent group reparented');
	eq(await js('absolute("D")'), deepPosition, 'transparent group translates children, not pinned geometry');
	await check('[c("N").geometry.x,c("N").geometry.y,c("N").geometry.width,c("N").geometry.height]', [0,0,0,0], 'transparent stored geometry stays pinned');
	await js('testUi.editor.undoManager.undo();');
	await settle();
	eq(await xml(), transparent, 'transparent group Undo is exact');
	await js('resetFixture();');
	await settle();
	await js(`var table=graph.createTable(2,2,100,40);table.id='T';table.geometry.x=400;table.geometry.y=450;graph.addCell(table,c('L1'));graph.refresh();testUi.editor.undoManager.clear();void 0;`);
	await settle();
	const tableXml=await xml(),tablePosition=await js('absolute("T")');
	await check('button("T","drag").disabled',false,'whole table remains movable; only its rows and cells are restricted');
	await js('dragRow("T","L2");');
	await settle();
	await check('c("T").parent.id','L2','whole table moves across layers');
	eq(await js('absolute("T")'),tablePosition,'whole table keeps absolute position');
	await js('testUi.editor.undoManager.undo();');
	eq(await xml(),tableXml,'whole-table move Undo is exact');
	await js('resetFixture();');
	await settle();
	await js('dragRow("L1","L2","before");');
	await settle();
	await check('graph.model.getRoot().children.map(c=>c.id)',['L2','L1'],'layers reorder only beneath root');
	await js('testUi.editor.undoManager.undo();');
	await settle();
	const edgeOrder=await xml();
	await js('dragRow("E","A","after");');
	await settle();
	await check('c("L1").children[0].id','E','edge can reorder within its parent');
	await js('testUi.editor.undoManager.undo();');
	eq(await xml(),edgeOrder,'edge reorder preserves terminals and complete data');
	await js('resetFixture();');
	await settle();
	console.log('PASS ' + checks + ' hierarchy checks, including safe drag/drop');

	const properties = [
		['expand','0',true],['autosize','1',false],['aspect','fixed',false],
		['resizable','0',false],['movable','0',false],['container','1',false],
		['noLabel','1',false],['snapToPoint','1',false],['allowArrows','0',false],['connectable','0',false]
	];
	await js('graph.setSelectionCell(c("A"));openMenu("A");');
	await check('Array.from(menuItem("properties").tbody.rows).filter(r=>r.dataset.quickStyler).length', 11, 'all 11 property entries');
	await check('graph.popupMenuHandler.tbody.rows.length>3', true, 'original context menu retained');
	for (const [id,value,initial] of properties)
	{
		await js('resetFixture();graph.setSelectionCells([c("A"),c("B")]);openMenu("B");');
		await check(`menuItem('${id}').getAttribute('aria-checked')`, String(initial), id + ' uses effective default');
		await js(`activateItem('${id}');`);
		await check(`[c('A'),c('B')].map(c=>String(graph.getCurrentCellStyle(c)['${id}']))`, [value,value], id + ' applies to all selected cells');
		eq(await undoSize(), 1, id + ' is one Undo');
		await js('testUi.editor.undoManager.undo();');
		await check('[(c("A").style||""),(c("B").style||"")]', ['',''], id + ' Undo restores unspecified keys');
		await js('testUi.editor.undoManager.redo();openMenu("B");');
		await check(`menuItem('${id}').getAttribute('aria-checked')`, String(!initial), id + ' Redo matches checked state');
	}
	await js(`resetFixture();graph.setCellStyles('movable','0',[c('A')]);graph.setSelectionCells([c('A'),c('B')]);testUi.editor.undoManager.clear();openMenu('B');`);
	await check('menuItem("movable").getAttribute("aria-checked")', 'mixed', 'mixed state uses all selected shapes');
	await js('activateItem("movable");');
	await check('[c("A"),c("B")].every(c=>graph.getCurrentCellStyle(c).movable=="0")', true, 'mixed state toggles all on');
	eq(await undoSize(), 1, 'mixed toggle is one Undo');
	await js(`resetFixture();graph.getStylesheet().putCellStyle('inherited',{aspect:'fixed',container:'1',movable:'0'});graph.model.setStyle(c('A'),'inherited');graph.setSelectionCell(c('A'));openMenu('A');`);
	await check('["aspect","container","movable"].map(k=>menuItem(k).getAttribute("aria-checked"))', ['true','true','true'], 'named styles affect checks');
	await js('activateItem("aspect");');
	await check('String(graph.getCurrentCellStyle(c("A")).aspect)', '0', 'explicit 0 overrides inherited fixed aspect');
	await js(`graph.model.setStyle(c('A'),'swimlane;');openMenu('A');`);
	await check('menuItem("container").getAttribute("aria-checked")', 'true', 'swimlane default is container');
	await js('activateItem("container");');
	await check('[graph.isContainer(c("A")),c("A").style.includes("container=0")]', [false,true], 'swimlane container off retains explicit 0');
	await js('resetFixture();graph.setSelectionCell(c("A"));');
	for (const [name,points] of [['all','[[0.5,0],[1,0.5],[0.5,1],[0,0.5]]'],['h','[[0,0.5],[1,0.5]]'],['v','[[0.5,0],[0.5,1]]'],['none',undefined]])
	{
		await js(`openMenu('A');activateItem('points-${name}');`);
		await check('graph.getCurrentCellStyle(c("A")).points', points, 'connection preset ' + name);
		await check('c("A").style.includes("constraintPoints=")', false, 'control-only key not serialized');
	}
	for (const [value,state] of [['[ [0, 0.50], [1.0, 0.5] ]','points-h'],['[]','constraintPoints'],['[[0.2,0.4]]','constraintPoints']])
	{
		await js(`graph.setCellStyles('points',${JSON.stringify(value)},[c('A')]);openMenu('A');`);
		await check(state == 'constraintPoints' ? 'menuItem("constraintPoints").textContent.includes("カスタム")' : `menuItem('${state}').getAttribute('aria-checked')==='true'`, true, 'normalize points or retain custom ' + value);
		await check('graph.getCurrentCellStyle(c("A")).points', value, 'opening menu preserves original points text');
	}
	await js('resetFixture();graph.setSelectionCell(c("A"));graph.container.focus();');
	await key('F10', ['shift']);
	await check('document.activeElement.dataset.quickStyler', 'properties', 'Shift+F10 opens same popup using selection');
	await key('Right');
	await check('document.activeElement.dataset.quickStyler', 'expand', 'Right opens properties submenu');
	await key('Down');
	await check('document.activeElement.dataset.quickStyler', 'autosize', 'Down moves through properties');
	await key('Enter');
	await check('String(graph.getCurrentCellStyle(c("A")).autosize)', '1', 'keyboard invokes property change');
	await check('treeTab().getAttribute("aria-selected")', 'true', 'styler does not switch hierarchy tab');
	await js('resetFixture();graph.setSelectionCell(c("A"));openMenu("A");activateItem("movable");');
	await settle();
	await check('button("A","drag").disabled',true,'Quick Styler position lock disables hierarchy dragging');
	await js('openMenu("A");activateItem("noLabel");');
	await settle();
	await check('[row("A").querySelector(".geHierarchyLabel").textContent,graph.model.isVisible(c("A"))]',['Rear',true],'Quick Styler noLabel preserves tree name and visibility');
	await js('resetFixture();graph.setCellStyles("container","1",[c("N")]);graph.setSelectionCell(c("N"));openMenu("N");activateItem("container");');
	await settle();
	const containerOff=await xml();
	await js('dragRow("C","N");');
	eq(await xml(),containerOff,'Quick Styler container off rejects hierarchy reparenting');
	await js('openMenu("N");activateItem("container");');
	await settle();
	await js('dragRow("C","N");');
	await check('c("C").parent.id','N','Quick Styler container on enables hierarchy reparenting');
	await check('treeTab().getAttribute("aria-selected")','true','combined property and hierarchy changes keep the tab');

	await js(`window.expectedErrors=[];window.originalHandleError=testUi.handleError;testUi.handleError=err=>expectedErrors.push(err.message);void 0;`);
	for (const ids of [['A','E'],['A','C'],['A','S']])
	{
		await js(`resetFixture();graph.setCellStyles('editable','0',[c('C')]);graph.setSelectionCells(${JSON.stringify(ids)}.map(c));testUi.editor.undoManager.clear();openMenu('A');`);
		eq(await selected(), ids, 'forbidden-context fixture retains all selected targets');
		const unchanged=await xml();
		await check('menuItem("container").getAttribute("aria-disabled")', 'true', 'mixed forbidden targets disable entire operation');
		await check('menuItem("container").title.length>0', true, 'disabled operation gives reason');
		await js('activateItem("container");');
		eq(await xml(), unchanged, 'disabled operation does not partially apply');
		eq(await undoSize(), 0, 'disabled operation adds no history');
	}
	await js(`resetFixture();graph.setSelectionCell(c('A'));openMenu('A');graph.setSelectionCell(c('B'));activateItem('container');`);
	eq(await undoSize(), 0, 'stale menu selection rejected');
	await check('expectedErrors.length', 1, 'stale selection produces cancellation reason');
	await js(`graph.setSelectionCell(c('A'));openMenu('A');testUi.selectPage(testUi.pages[1]);activateItem('container');`);
	await check('expectedErrors.length', 2, 'stale page rejected');
	await js('testUi.handleError=originalHandleError;resetFixture();');
	await settle();
	console.log('PASS ' + checks + ' checks, including Quick Styler properties and keyboard');

	await js(`
		window.stylesKey='drawio-quick-styler-styles';localStorage.removeItem(stylesKey);
		window.manager=()=>document.querySelector('.geQuickStylerDialog');
		window.styleName=name=>{const input=manager().querySelector('input');input.value=name;input.dispatchEvent(new Event('input',{bubbles:true}));};
		window.manageButton=label=>Array.from(manager().querySelectorAll('button')).find(b=>b.textContent===label);
		graph.model.setStyle(c('A'),'fillColor=#aaaaaa;');
		graph.model.setStyle(c('B'),'named;fillColor=#bbbbbb;glass=0;aspect=0;container=0;noLabel=1;expand=0;points=[];fontSize=14;');
		graph.setSelectionCells([c('A'),c('B')]);testUi.editor.undoManager.clear();testUi.getCurrentFile().setModified(false);
		openMenu('B');activateItem('manage');void 0;
	`);
	await check('manager().textContent.includes("Front (B)")', true, 'manager identifies right-clicked source, not first selection');
	await check('manageButton("保存").disabled', true, 'empty name cannot be saved');
	await js('testUi.setDarkMode(true);');
	await pause(300);
	fs.writeFileSync(path.join(process.env.DRAWIO_PLUGIN_TEST_PROFILE,'styler-dark.png'),(await win.webContents.capturePage()).toPNG());
	await js('testUi.setDarkMode(false);');
	await pause(300);
	fs.writeFileSync(path.join(process.env.DRAWIO_PLUGIN_TEST_PROFILE,'styler-light.png'),(await win.webContents.capturePage()).toPNG());
	await js('graph.setSelectionCell(c("A"));graph.model.setStyle(c("B"),"fillColor=#cccccc;");testUi.editor.undoManager.clear();testUi.getCurrentFile().setModified(false);styleName("  Test preset  ");');
	const afterSourceChange = await xml();
	await click('manageButton("保存")');
	await check('JSON.parse(localStorage.getItem(stylesKey))', [{name:'Test preset',style:{fillColor:'#bbbbbb',glass:'0',aspect:'0',container:'0',fontSize:'14'}}], 'save uses opening snapshot and exact allowlist, preserving zero');
	await check('manager().querySelector("input").value', '', 'successful save clears input');
	eq(await xml(), afterSourceChange, 'preset management does not mutate graph');
	eq(await undoSize(), 0, 'preset management adds no diagram Undo');
	await check('testUi.getCurrentFile().isModified()', false, 'preset management leaves file clean');
	await js(`styleName('IME');var nameInput=manager().querySelector('input');nameInput.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));nameInput.focus();`);
	await key('Enter');
	await check('JSON.parse(localStorage.getItem(stylesKey)).length', 1, 'IME Enter does not save style');
	await js('nameInput.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));');
	await key('Enter');
	await check('JSON.parse(localStorage.getItem(stylesKey)).length', 2, 'Enter after IME saves style');
	await js('styleName("Test preset");');
	await click('manageButton("保存")');
	await check('testUi.dialogs.length', 2, 'same-name update asks confirmation');
	await check('testUi.dialog.container.textContent.includes("Test preset")', true, 'confirmation names exact target');
	await key('Escape');
	await check('testUi.dialogs.length', 1, 'Escape closes only confirmation');
	await check('manageButton("保存").disabled', false, 'cancelled confirmation does not strand manager');
	await click('manageButton("保存")');
	await click('testUi.dialog.container.querySelector(".gePrimaryBtn")');
	await check('testUi.dialogs.length', 1, 'confirm update returns to manager');
	await js('styleName("IME");');
	await click('manageButton("削除")');
	await check('testUi.dialog.container.textContent.includes("IME")', true, 'delete confirmation names target');
	await click('testUi.dialog.container.querySelector(".gePrimaryBtn")');
	await check('JSON.parse(localStorage.getItem(stylesKey)).map(s=>s.name)', ['Test preset'], 'confirmed delete updates storage');
	await js(`styleName('Keep on failure');window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===stylesKey)throw new DOMException('Quota exceeded','QuotaExceededError');return originalSetItem.call(this,k,v);};void 0;`);
	await click('manageButton("保存")');
	await check('manager().querySelector("input").value', 'Keep on failure', 'storage failure retains input');
	await check('manager().querySelector("[role=status]").textContent.includes("保存できません")', true, 'storage failure is visible');
	await check('JSON.parse(localStorage.getItem(stylesKey)).length', 1, 'storage failure preserves old presets');
	await js('Storage.prototype.setItem=originalSetItem;void 0;');
	await key('Escape');
	await key('Escape');
	await check('manager()==null && testUi.dialogs.length===0', true, 'repeated Escape closes manager without exception');
	await js(`graph.model.setStyle(c('A'),'rounded=1;strokeColor=#123456;points=[];expand=0;');graph.setSelectionCell(c('A'));testUi.editor.undoManager.clear();openMenu('A');activateItem('saved-Test preset');`);
	await check('["rounded","strokeColor","points","expand"].map(k=>String(graph.getCurrentCellStyle(c("A"))[k]))', ['1','#123456','[]','0'], 'preset preserves keys absent from saved style');
	await check('["fillColor","glass","aspect","container","fontSize"].map(k=>String(graph.getCurrentCellStyle(c("A"))[k]))', ['#bbbbbb','0','0','0','14'], 'preset applies only captured keys, including explicit 0');
	eq(await undoSize(), 1, 'multi-key preset is one Undo');
	const appliedStyle = await xml();
	await js('testUi.editor.undoManager.undo();');
	await check('c("A").style', 'rounded=1;strokeColor=#123456;points=[];expand=0;', 'preset Undo restores full previous style');
	await js('testUi.editor.undoManager.redo();');
	eq(await xml(), appliedStyle, 'preset Redo exactly restores model');
	await js('openMenu("A");activateItem("saved-Test preset");');
	eq(await undoSize(), 1, 'applying identical preset adds no Undo');
	await js(`var savedDiagram=testUi.getFileData();testUi.setFileData(savedDiagram);`);
	eq(await xml(), appliedStyle, 'preset survives serialization and reload');
	await js(`window.savedPresets=localStorage.getItem(stylesKey);graph.setSelectionCell(c('A'));`);
	for (const broken of ['{bad', JSON.stringify([{name:'Bad',style:{fillColor:'#fff;locked=0'}}]),
		JSON.stringify([{name:'Bad',style:{locked:'0'}}]), JSON.stringify([{name:'Bad',style:{fillColor:3}}]),
		JSON.stringify([{name:'Same',style:{}},{name:'Same',style:{}}])])
	{
		await js(`localStorage.setItem(stylesKey,${JSON.stringify(broken)});openMenu('A');`);
		await check('!!menuItem("storage-error")', true, 'malformed preset is not offered for application');
		await js('activateItem("manage");styleName("Do not overwrite");');
		await click('manageButton("保存")');
		await check('localStorage.getItem(stylesKey)', broken, 'invalid storage is not silently replaced');
		await check('manager().querySelector("input").value', 'Do not overwrite', 'invalid storage preserves input');
		await key('Escape');
	}
	await js('localStorage.setItem(stylesKey,savedPresets);resetFixture();');
	await settle();
	console.log('PASS ' + checks + ' checks, including preset storage, Undo and invalid data');

	await js('graph.setEnabled(false);');
	await settle();
	await check('button("A","rename").disabled && button("A","visibility").disabled && button("A","drag").disabled', true, 'read-only disables tree changes');
	await js('graph.setSelectionCell(c("A"));openMenu("A");');
	await check('menuItem("container").getAttribute("aria-disabled")', 'true', 'read-only disables style changes');
	await js('graph.setEnabled(true);graph.popupMenuHandler.hideMenu();graph.setCellsSelectable(false);');
	await click('row("B").querySelector(".geHierarchyLabel")');
	eq(await selected(), ['A'], 'global selection restriction is respected');
	await js('graph.setCellsSelectable(true);resetFixture();');
	await settle();
	for (const style of ['part=1;','childLayout=stackLayout;','childLayout=tableLayout;'])
	{
		await js(`graph.model.setStyle(c('G'),${JSON.stringify(style)});graph.refresh();testUi.editor.undoManager.clear();`);
		await settle();
		await check('button("C","drag").disabled', true, 'managed structure blocks child drag: ' + style);
		const unchanged=await xml();
		await js('dragRow("C","L2");');
		eq(await xml(), unchanged, 'managed structure cannot be changed via tree');
		await js('resetFixture();');
		await settle();
	}
	await js('var relative=c("C").geometry.clone();relative.relative=true;graph.model.setGeometry(c("C"),relative);void 0;');
	await settle();
	await check('button("C","drag").disabled', true, 'relative children cannot be structurally moved');
	await js('resetFixture();graph.setCellStyles("movable","0",[c("N")]);');
	await settle();
	const fixedChild = await js('absolute("C")');
	await check('button("N","drag").disabled', true, 'movable=0 disables source drag');
	await js('dragRow("C","N");');
	await settle();
	await check('c("C").parent.id', 'N', 'fixed-position container can still accept children');
	eq(await js('absolute("C")'), fixedChild, 'fixed target does not move child');
	await js('resetFixture();');
	await settle();
	await js(`dragRow('C','L2','inside',()=>{graph.setCellStyles('locked','1',[c('L2')]);window.atDrop=modelXml();window.atDropHistory=testUi.editor.undoManager.history.length;});`);
	await check('modelXml()===atDrop && testUi.editor.undoManager.history.length===atDropHistory', true, 'drop revalidates a newly locked destination');
	await js('resetFixture();');
	await settle();
	const beforeFailure=await xml();
	await js(`var addCells=graph.cellsAdded;graph.cellsAdded=function(){addCells.apply(this,arguments);throw new Error('Injected drop failure');};dragRow('C','L2');graph.cellsAdded=addCells;void 0;`);
	await settle();
	eq(await xml(), beforeFailure, 'failed reparent rolls back every partial change');
	eq(await undoSize(), 0, 'failed reparent adds no Undo');
	await check('document.querySelector(".geHierarchyStatus").textContent.includes("Injected drop failure")', true, 'failed operation gives reason');
	await js(`graph.setSelectionCells([c('A'),c('B')]);openMenu('A');var setStyle=graph.model.setStyle;var calls=0;graph.model.setStyle=function(){setStyle.apply(this,arguments);if(++calls===2)throw new Error('Injected style failure');};testUi.handleError=err=>expectedErrors.push(err.message);activateItem('container');graph.model.setStyle=setStyle;testUi.handleError=originalHandleError;void 0;`);
	eq(await xml(), beforeFailure, 'failed multiple-selection style rolls back completely');
	eq(await undoSize(), 0, 'failed style adds no Undo');
	await js('resetFixture();');
	await settle();
	await click('button("A","rename")');
	await js('row("A").querySelector("input").value="Uncommitted";graph.setSelectionCell(c("B"));void 0;');
	await settle();
	await check('row("A").querySelector("input").value', 'Uncommitted', 'selection does not redraw active input');
	await js('graph.removeCells([c("A")]);void 0;');
	await settle();
	await check('row("A")==null', true, 'deleting edited target cancels input');
	await js('testUi.editor.undoManager.undo();');
	await settle();
	await check('c("A").value', 'Rear', 'deleted-target input never commits');
	await click('button("A","rename")');
	await js('row("A").querySelector("input").value="Blur commit";');
	await click('row("B").querySelector(".geHierarchyLabel")');
	await check('c("A").value', 'Blur commit', 'ordinary blur commits rename');
	await js('resetFixture();');
	await settle();
	await click('button("A","rename")');
	await key('Enter');
	eq(await undoSize(), 0, 'unchanged label creates no Undo');
	await js('button("B","visibility").focus();');
	await key('F2');
	await check('!!row("B").querySelector("input")', true, 'F2 works from buttons inside a row');
	await key('Escape');
	await js('graph.setSelectionCells([c("A"),c("B")]);graph.scrollCellToVisible(c("B"));void 0;');
	const canvasPoint=await js('(()=>{const s=graph.view.getState(c("B")),r=graph.container.getBoundingClientRect();return {x:r.x+s.getCenterX()-graph.container.scrollLeft,y:r.y+s.getCenterY()-graph.container.scrollTop};})()');
	send('mouseDown',canvasPoint.x,canvasPoint.y,{button:'right',clickCount:1});
	send('mouseUp',canvasPoint.x,canvasPoint.y,{button:'right',clickCount:1});
	await settle();
	eq(await selected(), ['A','B'], 'native right click preserves multiple selection');
	await check('!!menuItem("properties")', true, 'native right click includes Quick Styler');
	await js('graph.popupMenuHandler.hideMenu();');
	console.log('PASS ' + checks + ' checks, including locked/read-only states and atomic failure rollback');
	await js('resetFixture();');
	await settle();
	// Intercept Chromium's native HTML drag session so this is a trusted drag,
	// not just the synthetic DOM events used for the exhaustive rejection cases.
	win.webContents.debugger.attach('1.3');
	try
	{
		await win.webContents.debugger.sendCommand('Input.setInterceptDrags',{enabled:true});
		const dragData=new Promise((resolve,reject)=>
		{
			const timeout=setTimeout(()=>{win.webContents.debugger.removeListener('message',listener);reject(new Error('Native hierarchy drag did not start'));},5000);
			const listener=(_event,method,params)=>
			{
				if(method==='Input.dragIntercepted'){clearTimeout(timeout);win.webContents.debugger.removeListener('message',listener);resolve(params.data);}
			};
			win.webContents.debugger.on('message',listener);
		});
		await js('window.trustedDrop=false;row("B").addEventListener("drop",e=>{trustedDrop=e.isTrusted;},{once:true});');
		const points=await js('(()=>{const a=button("A","drag").getBoundingClientRect(),b=row("B").getBoundingClientRect();return {x:a.x+a.width/2,y:a.y+a.height/2,toX:b.x+b.width/2,toY:b.y+b.height*0.1};})()');
		await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x,y:points.y});
		await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:points.x,y:points.y,button:'left',buttons:1,clickCount:1});
		for(let i=1;i<=5;i++)
		{
			await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x+(points.toX-points.x)*i/5,y:points.y+(points.toY-points.y)*i/5,button:'left',buttons:1});
			await pause(30);
		}
		const data=await dragData;
		for(const type of ['dragEnter','dragOver','drop'])
			await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type,x:points.toX,y:points.toY,data});
		await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.toX,y:points.toY,button:'left',buttons:0,clickCount:1});
		await settle();
		await check('trustedDrop', true, 'native Chromium drag delivers trusted drop');
		await check('c("L1").children.slice(0,2).map(c=>c.id)', ['B','A'], 'native handle drag reorders exactly once');
		eq(await undoSize(),1,'native drag is one Undo');
	}
	finally {win.webContents.debugger.detach();}

	await js('resetFixture();graph.setSelectionCell(c("C"));testUi.setDarkMode(false);');
	await settle();
	const screenshotDir=process.env.DRAWIO_PLUGIN_TEST_PROFILE;
	fs.writeFileSync(path.join(screenshotDir,'hierarchy-light.png'),(await win.webContents.capturePage()).toPNG());
	await js('testUi.setDarkMode(true);');
	await pause(300);
	const darkColor=await js('getComputedStyle(row("C")).backgroundColor');
	fs.writeFileSync(path.join(screenshotDir,'hierarchy-dark.png'),(await win.webContents.capturePage()).toPNG());
	await js('testUi.setDarkMode(false);');
	await settle();
	assert.notEqual(await js('getComputedStyle(row("C")).backgroundColor'),darkColor,'selection colors follow light/dark theme');checks++;
	await js('testUi.toggleFormatPanel(false);');
	await check('testUi.actions.get("toggleHierarchyViewer").isSelected()', false, 'menu unchecked when sidebar hidden');
	await js('testUi.actions.get("toggleHierarchyViewer").funct();');
	await settle();
	await check('testUi.isFormatPanelVisible() && treeTab().getAttribute("aria-selected")==="true"', true, 'menu reveals sidebar and hierarchy');
	await js('testUi.actions.get("toggleHierarchyViewer").funct();');
	await check('formatTab().getAttribute("aria-selected")', 'true', 'menu toggles back to Format');
	await key('End');
	await click('treeTab()');
	win.setSize(900,650);
	await settle();
	await check('(()=>{const h=testUi.formatContainer.getBoundingClientRect(),t=document.querySelector(".geHierarchyTabs").getBoundingClientRect(),p=document.querySelector(".geHierarchyPane").getBoundingClientRect();return h.width>100&&p.top>=t.bottom&&p.bottom<=h.bottom+1;})()', true, 'resized dock contents do not overlap tabs or host');
	fs.writeFileSync(path.join(screenshotDir,'hierarchy-narrow.png'),(await win.webContents.capturePage()).toPNG());
	win.setSize(1440,1000);
	await settle();
	console.log('Screenshots: '+screenshotDir);
	await js('graph.setSelectionCell(c("A"));');
	await click('formatTab()');
	await click('testUi.format.container.querySelectorAll(".geFormatTitle")[1]');
	await check('testUi.format.currentIndex',1,'existing Text tab remains operable');
	await click('treeTab()');
	await js('graph.clearSelection();graph.setSelectionCell(c("B"));void 0;');
	await click('formatTab()');
	await check('testUi.format.currentIndex',1,'Format remembers its own tab across hierarchy selection');
	await click('Array.from(testUi.format.container.querySelectorAll("[title]")).find(e=>e.title.startsWith(mxResources.get("bold")+" ("))');
	await check('(Number(graph.getCurrentCellStyle(c("B")).fontStyle)&mxConstants.FONT_BOLD)!==0',true,'original Text control changes selected label style');
	await click('testUi.format.container.querySelectorAll(".geFormatTitle")[2]');
	await click('Array.from(testUi.format.container.querySelectorAll("input")).find(e=>e.title===mxResources.get("width"))');
	await js('document.activeElement.value="120";');
	await key('Enter');
	await check('c("B").geometry.width',120,'original Arrange width control changes geometry');
	await click('testUi.format.container.querySelectorAll(".geFormatTitle")[0]');
	await click('Array.from(testUi.format.container.querySelectorAll(".geCollapsibleTitle")).find(e=>e.title===mxResources.get("effects"))');
	await click('Array.from(testUi.format.container.querySelectorAll("input")).find(e=>e.title===mxResources.get("rounded"))');
	await check('String(graph.getCurrentCellStyle(c("B")).rounded)','1','original Style control changes selected shape');
	await js('window.oldRow=row("A");graph.cellLabelChanged(c("A"),"Deferred label");');
	await settle();
	await check('row("A")===oldRow',true,'hidden tree defers structural redraw');
	await click('treeTab()');
	await check('row("A").querySelector(".geHierarchyLabel").textContent','Deferred label','showing tree flushes deferred update');
	await js(`graph.model.beginUpdate();try {graph.model.setVisible(c('E'),false);var cycle=new mxCell('',new mxGeometry(),'');cycle.id='CYCLE';cycle.setEdge(true);cycle.setVisible(false);graph.model.add(c('L1'),cycle);graph.model.setTerminal(cycle,c('E'),true);graph.model.setTerminal(c('E'),cycle,true);}finally{graph.model.endUpdate();}void 0;`);
	await settle();
	await check('row("E").querySelector(".geHierarchyLabel").textContent.includes("接続線 E")',true,'cyclic edge labels terminate at ID fallback');
	await js('resetFixture();');
	await settle();
	const loadPlugin=async name=>js(fs.readFileSync(path.join(__dirname,'../../drawio/src/main/webapp/plugins',name+'.js'),'utf8'));
	const hooks=await js('testUi.destroyFunctions.length');
	for(const name of ['hierarchy-viewer','quick-styler','quick-styler','hierarchy-viewer'])await loadPlugin(name);
	await check('testUi.destroyFunctions.length',hooks,'duplicate plugin initialization adds no cleanup hooks');
	await check('document.querySelectorAll(".geHierarchyTabs").length',1,'duplicate initialization adds no tabs');
	await js('graph.setSelectionCell(c("A"));openMenu("A");');
	await check('graph.popupMenuHandler.tbody.querySelectorAll("[data-quick-styler]").length',2,'duplicate initialization adds no popup entries');
	await js('activateItem("manage");activateItem("manage");');
	await check('document.querySelectorAll(".geQuickStylerDialog").length',1,'reopening manager reuses the dialog');
	await js('testUi.quickStyler.destroy();');
	await check('manager()==null && testUi.dialogs.length===0',true,'manual styler cleanup closes its dialog');
	await click('button("A","rename")');
	await js('row("A").querySelector("input").value="Must cancel";testUi.hierarchyViewer.destroy();');
	await check('c("A").value','Rear','plugin destruction cancels inline input');
	await check('testUi.format.container===testUi.formatContainer && document.querySelectorAll(".geHierarchyTabs").length===0',true,'cleanup restores original Format host');
	await js(`localStorage.setItem('drawio-hierarchy-viewer-tab','broken');graph.container.focus();window.basePopup=testUi.menus.createPopupMenu;window.baseCalls=0;testUi.menus.createPopupMenu=function(){baseCalls++;return basePopup.apply(this,arguments);};void 0;`);
	await settle();
	await js('window.beforePluginFocus=document.activeElement;void 0;');
	await loadPlugin('quick-styler');
	await loadPlugin('hierarchy-viewer');
	await settle();
	await check('formatTab().getAttribute("aria-selected")','true','invalid tab setting falls back to Format');
	await check('document.activeElement===beforePluginFocus',true,'initialization does not steal canvas focus');
	await js('openMenu("A");');
	await check('baseCalls',1,'pre-existing popup wrapper is invoked exactly once');
	await js(`graph.popupMenuHandler.hideMenu();Storage.prototype.setItem=function(k,v){if(k==='drawio-hierarchy-viewer-tab')throw new Error('Storage blocked');return originalSetItem.call(this,k,v);};void 0;`);
	await click('treeTab()');
	await check('formatTab().getAttribute("aria-selected")','true','unwritable tab setting falls back without failing');
	await js('Storage.prototype.setItem=originalSetItem;void 0;');
	await click('treeTab()');
	await js(`graph.setCellStyles('fillColor','#aaaaaa',[c('A')]);openMenu('A');activateItem('manage');styleName('Test preset');`);
	await click('manageButton("保存")');
	await check('testUi.dialogs.length',2,'confirmation is open for destruction test');
	await js('testUi.destroy();');
	await pause(100);
	await check('document.querySelectorAll(".geHierarchyTabs,.geHierarchyPane,.geQuickStylerDialog").length',0,'EditorUi destruction removes plugin DOM');
	await check('testUi.dialogs.length',0,'EditorUi destruction closes both owned dialogs after editor teardown');
	await check('testUi.hierarchyViewer==null && testUi.quickStyler==null',true,'EditorUi destruction clears instance state');
	console.log('PASS '+checks+' plugin GUI assertions');
};
