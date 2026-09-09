const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({win, fs}) => {
 const run = code => win.webContents.executeJavaScript(code);
 const fixture = fs.readFileSync(path.join(__dirname, '../../docs/selection/reproduction.drawio'), 'utf8');
 await run(`window.fixture=mxUtils.parseXml(${JSON.stringify(fixture)});
 window.undo=new mxUndoManager(); graph.model.addListener(mxEvent.UNDO,function(s,e){undo.undoableEditHappened(e.getProperty('edit'));});
 window.keys=new mxKeyHandler(graph);void 0;`);
 const pause = () => new Promise(resolve => setTimeout(resolve, 40));
 const send = (type, x, y, extra = {}) => win.webContents.sendInputEvent({type, x:Math.round(x), y:Math.round(y), ...extra});
 const move = async (x,y) => {send('mouseMove',x,y);await pause();};
 const selection = () => run('graph.getSelectionCells().map(c=>c.id).sort()');
 const click = async (x,y,modifiers=[]) => {
  await move(x,y);
  send('mouseDown',x,y,{button:'left',clickCount:1,modifiers});
  send('mouseUp',x,y,{button:'left',clickCount:1,modifiers});
  await pause(); return selection();
 };
 const drag = async (x,y,dx,dy) => {
  await move(x,y);send('mouseDown',x,y,{button:'left',clickCount:1});
  for(let i=1;i<=4;i++) {await move(x+dx*i/4,y+dy*i/4);}
  send('mouseUp',x+dx,y+dy,{button:'left',clickCount:1});await pause();
 };
 const load = async (page,zoom) => {
  await run(`graph.stopEditing(true);graph.clearSelection();graph.clearSelectionContainerHints();
   var doc=mxUtils.parseXml(mxUtils.getXml(fixture.getElementsByTagName('mxGraphModel')[${page-1}]));
   new mxCodec(doc).decode(doc.documentElement,graph.model);
   graph.view.scaleAndTranslate(${zoom},0,0);graph.refresh();undo.clear();`);
  await pause();
 };
 const bounds = id => run(`(function(){var s=graph.view.getState(graph.model.getCell(${JSON.stringify(id)}));return {x:s.x,y:s.y,w:s.width,h:s.height};})()`);
 const center = async id => {const b=await bounds(id);return [b.x+b.w/2,b.y+b.h/2];};
 const xml = () => run('mxUtils.getXml(new mxCodec().encode(graph.model))');
 let checks=0;
 const eq = (a,b,label) => {assert.deepEqual(a,b,label);checks++;};
 for (const zoom of [0.5,1,2]) {
  for (let page=process.argv.includes('--extended-only')?11:1;page<=10;page++) {
   await load(page,zoom);
   const original=await xml();
   let b=await center('B');
   eq(await click(...b),[page===7||page===8?'A':'B'],`page ${page} zoom ${zoom}: first click`);
   eq(await click(...b),[page===8?'A':'B'],`page ${page} zoom ${zoom}: repeated click`);
   eq(await xml(),original,'selection must not change serialized geometry or order');
   if(page<=4) {
    const c=await center('C'),a=await bounds('A');
    eq(await click(...c),[page===4?'A':'C'],'background selection');
    eq(await click(a.x+a.w-35*zoom,a.y+a.h-35*zoom),page===4?['A']:[],'blank selection');
    await load(page,zoom);
    await drag(a.x+15*zoom,a.y+60*zoom,200*zoom,160*zoom);
    eq(await selection(),[page===4?'A':'B'],'rubberband or opaque drag');
    eq(await run("graph.model.getGeometry(graph.model.getCell('A')).x"),page===4?360:160,'parent is not moved by rubberband');
   }
   if(page!==7) {
    await load(page,zoom);b=await center('B');
    const before=await bounds('B');
    await click(...b);await drag(...b,20*zoom,20*zoom);
    const after=await bounds('B');
    eq([after.x-before.x,after.y-before.y],[20*zoom,20*zoom],'selected child/group drag');
    if(page===8) {
     const c=await bounds('C');
     eq(c.x,420*zoom,'locked group moves sibling with child');
    }
    await run('undo.undo()');eq(await bounds('B'),before,'undo drag');
    await run('undo.redo()');eq(await bounds('B'),after,'redo drag');
    const saved=await xml();
    await run(`var saved=mxUtils.parseXml(${JSON.stringify(saved)});new mxCodec(saved).decode(saved.documentElement,graph.model);graph.view.scaleAndTranslate(${zoom},0,0);graph.refresh();`);
    eq(await bounds('B'),after,'save/reload preserves position');
   }
   if(page===5||page===6) {
    await load(page,zoom);await click(...await center('B'));
    eq(await click(...await center('C'),['shift']),['B','C'],'shift adds sibling');
    eq(await click(...await center('C'),['shift']),['B'],'shift removes sibling');
   }
   await load(page,zoom);b=await center('B');
   await click(...b);
   send('mouseDown',...b,{button:'left',clickCount:2});
   send('mouseUp',...b,{button:'left',clickCount:2});await pause();
   eq(await run('graph.cellEditor.editingCell && graph.cellEditor.editingCell.id'),page===8?null:'B','double click edits child except locked groups');
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
   win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await pause();
   eq(await run('graph.isEditing()'),false,'Escape ends editing');
   console.log(`PASS page=${page} zoom=${zoom}`);
  }
  await load(9,zoom);
  await move(...await center('B'));
  const hints=await run("graph.selectionContainerHints.map(h=>({id:h.cell.id,title:h.handle.node.getAttribute('title'),x:h.handle.bounds.getCenterX(),y:h.handle.bounds.getCenterY()}))");
  eq(hints.map(h=>h.id),['G','A'],'nested ancestor hints');
  assert(hints.every(h=>h.title));checks++;
  assert(hints[0].x!==hints[1].x||hints[0].y!==hints[1].y);checks++;
  eq(await run("graph.selectionContainerHints.map(h=>h.handle.node.querySelector('title').textContent)"),['group (2)','group (1)'],'SVG hover tooltips identify hierarchy');
  eq(await click(hints[1].x,hints[1].y),['A'],'explicit outer handle wins');
  await click(...await center('B'));
  eq(await run("['G','A'].map(id=>graph.selectionCellsHandler.getHandler(graph.model.getCell(id)).customHandles.find(h=>h.moveGroupHandle).shape.node.querySelector('title').textContent)"),['group (2)','group (1)'],'selected ancestors retain hierarchy tooltips');
  await load(10,zoom);
  const c=await bounds('C');
  eq(await click(c.x+3*zoom,c.y+c.h/2),['C'],'exposed back shape selected');
  const front=await bounds('B');
  const back=await bounds('C');
  const handle=await run("(function(){var h=graph.selectionCellsHandler.getHandler(graph.model.getCell('C')).customHandles.find(h=>h.moveGroupHandle);return [h.shape.bounds.getCenterX(),h.shape.bounds.getCenterY()];})()");
  await drag(...handle,-20*zoom,20*zoom);
  const moved=await bounds('C');
  eq([moved.x-back.x,moved.y-back.y],[-20*zoom,20*zoom],'back shape moves from explicit handle');
  eq(await bounds('B'),front,'front shape stays in place');
  eq(await click(...await center('B')),['B'],'front click replaces back selection');

  await load(1,zoom);
  const a=await bounds('A');
  eq(await click(a.x,a.y+a.h/2),['A'],'parent border selects parent');
  await run('graph.clearSelection()');
  const title=await run("(function(){var b=graph.view.getState(graph.model.getCell('A')).text.boundingBox;return [b.getCenterX(),b.getCenterY()];})()");
  eq(await click(...title),['A'],'parent title selects parent');
  await run("var g=graph.model.getGeometry(graph.model.getCell('B')).clone();g.x=150;g.y=-20;graph.model.setGeometry(graph.model.getCell('B'),g);graph.clearSelection();");
  eq(await click(...title),['B'],'child wins over parent title');
  const borderPoint=[a.x+175*zoom,a.y];
  eq(await click(...borderPoint),['B'],'child wins over parent border');
  await run("graph.setSelectionCell(graph.model.getCell('A'));");
  eq(await click(...borderPoint),['B'],'selected parent border still gives child priority');

  await load(1,zoom);
  const borderChild=await bounds('B'),borderBack=await bounds('C');
  // Avoid the explicit connection point at the middle of the border.
  await drag(a.x,a.y+190*zoom,20*zoom,20*zoom);
  const borderMoved=await bounds('B');
  eq([borderMoved.x-borderChild.x,borderMoved.y-borderChild.y],[20*zoom,20*zoom],'parent border moves child with parent');
  eq(await bounds('C'),borderBack,'parent move does not move background');

  await load(1,zoom);await move(...await center('B'));
  const hoverHandle=await run("(function(){var h=graph.selectionContainerHints[0].handle.bounds;return [h.getCenterX(),h.getCenterY()];})()");
  await move(...await center('C'));
  eq(await run('graph.selectionContainerHints.map(h=>h.cell.id)'),['A'],'hover handle survives crossing background');
  eq(await click(...hoverHandle),['A'],'parent handle is reachable across background');

  await load(1,zoom);
  await run("graph.setCellStyles('rotation','45',[graph.model.getCell('A')]);");
  eq(await click(...await center('C')),['C'],'rotated transparent container passes through');
  const rotated=await run("(function(){var s=graph.view.getState(graph.model.getCell('A'));var p=mxUtils.getRotatedPoint(new mxPoint(s.getCenterX(),s.y),Math.SQRT1_2,Math.SQRT1_2,new mxPoint(s.getCenterX(),s.getCenterY()));return [p.x,p.y];})()");
  eq(await click(...rotated),['A'],'rotated border is selectable');

  await load(9,zoom);await move(...await center('B'));
  const inner=await run("(function(){var h=graph.selectionContainerHints.find(h=>h.cell.id==='G').handle.bounds;return [h.getCenterX(),h.getCenterY()];})()");
  const sibling=await bounds('D'),grandchild=await bounds('B');
  await drag(...inner,20*zoom,20*zoom);
  const newGrandchild=await bounds('B');
  eq([newGrandchild.x-grandchild.x,newGrandchild.y-grandchild.y],[20*zoom,20*zoom],'inner parent handle moves its child');
  eq(await bounds('D'),sibling,'inner parent move leaves outer sibling unchanged');

  await load(6,zoom);
  const autoBefore=await bounds('A');
  await run("graph.removeCells([graph.model.getCell('C')]);");
  const autoAfter=await bounds('A');
  assert(autoAfter.w<autoBefore.w&&autoAfter.h<autoBefore.h,'automatic bounds shrink after child deletion');checks++;
  await run('undo.undo()');eq(await bounds('A'),autoBefore,'undo restores automatic bounds');
  await click(...await center('C'));
  const resize=await run("(function(){var b=graph.selectionCellsHandler.getHandler(graph.model.getCell('C')).sizers[7].bounds;return [b.getCenterX(),b.getCenterY()];})()");
  await drag(...resize,-20*zoom,-20*zoom);
  const shrunk=await bounds('A');
  assert(shrunk.w<autoBefore.w&&shrunk.h<autoBefore.h,'automatic bounds follow a child resize');checks++;
  eq(await run("(function(){var g=graph.model.getGeometry(graph.model.getCell('A'));return [g.x,g.y];})()"),[0,0],'automatic resizing keeps the group origin stable');

  await load(5,zoom);
  await drag(140*zoom,130*zoom,440*zoom,260*zoom);
  const regionSelection=await selection();
  assert(regionSelection.includes('A'),'rubberband selects the enclosed parent');checks++;
  const regionChild=await bounds('B');
  const regionHandle=await run("(function(){var h=graph.selectionCellsHandler.getHandler(graph.model.getCell('A')).customHandles.find(h=>h.moveGroupHandle).shape.bounds;return [h.getCenterX(),h.getCenterY()];})()");
  await drag(...regionHandle,20*zoom,20*zoom);
  const regionMoved=await bounds('B');
  eq([regionMoved.x-regionChild.x,regionMoved.y-regionChild.y],[20*zoom,20*zoom],'region-selected parent and children move only once');

  await load(5,zoom);
  await run('graph.setConnectable(true);');
  const source=await bounds('B'),target=await center('C');
  await move(source.x+source.w/2,source.y+source.h/2);
  await move(source.x+source.w,source.y+source.h/2);
  eq(await run('graph.connectionHandler.constraintHandler.currentFocus?.cell.id'),'B','source connection focus');
  const edgeCount=await run("graph.model.getChildEdges(graph.model.getCell('A')).length");
  await drag(source.x+source.w,source.y+source.h/2,target[0]-(source.x+source.w),target[1]-(source.y+source.h/2));
  eq(await run("graph.model.getChildEdges(graph.model.getCell('A')).length"),edgeCount+1,'drag from connection point adds edge');
  eq(await run("graph.model.getChildEdges(graph.model.getCell('A')).map(e=>[e.source?.id,e.target?.id])"),[['B','C'],['B','C']],'connection terminals preserved');

  await load(5,zoom);
  await run("graph.setCellStyles('movable','0',[graph.model.getCell('A')]);");
  await move(...await center('B'));
  const fixedHandle=await run("(function(){var h=graph.selectionContainerHints.find(h=>h.cell.id==='A').handle.bounds;return [h.getCenterX(),h.getCenterY()];})()");
  const fixed=await bounds('A');
  eq(await click(...fixedHandle),['A'],'immovable parent remains explicitly selectable');
  await run('graph.clearSelection()');await move(...await center('B'));
  await drag(...fixedHandle,20*zoom,20*zoom);
  eq(await bounds('A'),fixed,'immovable parent cannot be dragged');

  for(const id of ['A','1']) {
   await load(8,zoom);await run(`graph.setCellStyles('locked','1',[graph.model.getCell('${id}')]);`);
   const locked=await bounds('B');
   await drag(...await center('B'),20*zoom,20*zoom);
   eq(await bounds('B'),locked,'cell/layer lock prevents group drag');
   eq(await run('graph.selectionContainerHints.length'),0,'locked group has no interactive hints');
  }
 }
 console.log(`PASS ${checks} GUI assertions`);
 const screenshot=process.argv.find(arg=>arg.startsWith('--screenshot='))?.slice(13);
 if(screenshot) {
  await load(9,1);await move(...await center('B'));
  fs.writeFileSync(screenshot.replace(/\.png$/, '-hover.png'),(await win.webContents.capturePage()).toPNG());
  await click(...await center('B'));
  fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
 }
};
