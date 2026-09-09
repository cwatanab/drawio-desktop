import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the editor's actual methods without starting Electron. DOM painting
// and native pointer dispatch still require the reproduction drawing.
const source = readFileSync(new URL('../../drawio/src/main/webapp/js/grapheditor/Graph.js', import.meta.url), 'utf8');
const context = vm.createContext({
	Graph: function() {},
	mxRectangleShape: function() {},
	mxLabel: function() {},
	document: {createElementNS: (namespaceURI, tagName) => ({namespaceURI, tagName})},
	mxPoint: function(x, y) { this.x = x; this.y = y; },
	mxConstants: {
		NONE: 'none', STYLE_FILLCOLOR: 'fillColor',
		STYLE_SWIMLANE_FILLCOLOR: 'swimlaneFillColor',
		STYLE_FILL_OPACITY: 'fillOpacity', STYLE_OPACITY: 'opacity',
		STYLE_STROKECOLOR: 'strokeColor', STYLE_STROKE_OPACITY: 'strokeOpacity',
		STYLE_ROTATION: 'rotation', NS_SVG: 'http://www.w3.org/2000/svg'
	},
	mxResources: {get: key => key},
	mxUtils: {
		write: (node, value) => { node.textContent = value; },
		bind: (scope, fn) => fn.bind(scope),
		getValue: (style, key, fallback) => style[key] ?? fallback,
		contains: (r, x, y) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height,
		toRadians: degrees => degrees * Math.PI / 180,
		getRotatedPoint: (p, cos, sin, c) => ({
			x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
			y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos
		})
	},
	mxEvent: {addListener() {}, removeListener() {}}
});
for (const name of ['isSelectionBackground', 'intersectsSelectionContainer', 'initSelectionContainerHints', 'updateSelectionContainerHandleTitle'])
{
	const start = source.indexOf(`Graph.prototype.${name} = function(`);
	assert.notEqual(start, -1);
	const end = source.indexOf('\n};', start);
	vm.runInContext(source.slice(start, end + 3), context);
}
const methods = context.Graph.prototype;

test('ordinary rectangles share background hit testing without treating other shapes as rectangles', () =>
{
	const graph = {
		isSelectionContainer: cell => cell.container === true,
		model: {isVertex: cell => cell.vertex === true},
		isPart: cell => cell.part === true,
		isTable: cell => cell.table === true
	};
	const rectangle = new context.mxRectangleShape();
	const matches = (cell, shape = rectangle) => methods.isSelectionBackground.call(graph, {cell, shape});
	assert.equal(matches({vertex: true}), true);
	assert.equal(matches({vertex: true}, new context.mxLabel()), true);
	for (const property of ['image', 'indicator', 'indicatorImage', 'indicatorShape'])
	{
		const label = new context.mxLabel();
		label[property] = {};
		assert.equal(matches({vertex: true}, label), false);
	}
	assert.equal(matches({vertex: true, part: true}), false);
	assert.equal(matches({vertex: true, table: true}), false);
	assert.equal(matches({vertex: false}), false);
	assert.equal(matches({vertex: true}, {}), false);
	assert.equal(matches({vertex: true}, null), false);
	assert.equal(matches({vertex: true, container: true}, {}), true);
});

function hit(style, x = 50, y = 50, extra = {})
{
	return methods.intersectsSelectionContainer.call({
		isSwimlane: () => false, tolerance: 4, ...extra
	}, {
		style, x: 0, y: 0, width: 100, height: 100,
		getCenterX: () => 50, getCenterY: () => 50
	}, x, y);
}

test('unfilled and zero-opacity interiors pass through; translucent interiors do not', () =>
{
	assert.equal(hit({fillColor: 'none'}), false);
	assert.equal(hit({fillColor: '#fff', fillOpacity: 0}), false);
	assert.equal(hit({fillColor: '#fff', opacity: '0'}), false);
	assert.equal(hit({fillColor: '#fff', fillOpacity: 30}), true);
});

test('visible borders remain selectable but invisible strokes pass through', () =>
{
	assert.equal(hit({fillColor: 'none', strokeColor: '#000'}, 1, 50), true);
	assert.equal(hit({fillColor: 'none', strokeColor: '#000', strokeOpacity: 0}, 1, 50), false);
	assert.equal(hit({fillColor: 'none', strokeColor: '#000', opacity: 0}, 1, 50), false);
});

test('border tolerance stays in screen pixels under CSS zoom', () =>
{
	const style = {fillColor: 'none', strokeColor: '#000'};
	assert.equal(hit(style, 3, 50), true);
	assert.equal(hit(style, 3, 50, {useCssTransforms: true, currentScale: 2}), false);
});

function hoverFixture(css = false)
{
	let listener;
	const events = {addListener() {}, removeListener() {}};
	const parent = {};
	const graph = {
		...events, model: {...events, isAncestor: (a, b) => a === b || b.parent === a},
		selectionModel: events, view: events, container: {},
		isEnabled: () => true, isEditing: () => false,
		panningHandler: {isActive: () => false},
		getSelectionContainerHandle: () => null, getLockedGroupAncestor: () => null,
		clearSelectionContainerHints() {}, destroy() {},
		addMouseListener(value) { listener = value; },
		showSelectionContainerHints(cell) { this.shown = cell; },
		useCssTransforms: css, currentScale: 2, currentTranslate: {x: 10, y: 20}
	};
	methods.initSelectionContainerHints.call(graph);
	graph.selectionContainerHints = [{cell: parent, bounds: {
		clone: () => ({x: 0, y: 0, width: 100, height: 100,
			grow(n) { this.x -= n; this.y -= n; this.width += 2 * n; this.height += 2 * n; }})
	}}];
	return {graph, parent, move(cell, x, y) {
		listener.mouseMove(graph, {
			getCell: () => cell, getEvent: () => ({}),
			getGraphX: () => x, getGraphY: () => y
		});
	}};
}

test('ancestor handles survive crossing a background cell within their bounds', () =>
{
	const f = hoverFixture();
	f.move({}, 50, 50);
	assert.equal(f.graph.shown, undefined);
	const outside = {};
	f.move(outside, 200, 200);
	assert.equal(f.graph.shown, outside);
});

test('hovering another child refreshes the ancestor handles', () =>
{
	const f = hoverFixture();
	const child = {parent: f.parent};
	f.move(child, 50, 50);
	assert.equal(f.graph.shown, child);
});

test('handle retention uses view coordinates under CSS zoom and translation', () =>
{
	const f = hoverFixture(true);
	f.move({}, 120, 140);
	assert.equal(f.graph.shown, undefined);
	const outside = {};
	f.move(outside, 400, 400);
	assert.equal(f.graph.shown, outside);
});

test('handle titles identify outer and inner levels, preserving plain-text labels', () =>
{
	const root = {};
	const outer = {parent: root, container: true, label: 'Parent <A>'};
	const inner = {parent: outer, container: true, label: ''};
	const graph = {
		getLabel: cell => cell.label,
		isHtmlLabel: () => false,
		isSelectionContainer: cell => cell.container === true,
		getCurrentRoot: () => root,
		model: {getParent: cell => cell.parent}
	};

	for (const [cell, expected] of [[outer, 'Parent <A> (1)'], [inner, 'group (2)']])
	{
		const node = {
			ownerSVGElement: {}, attributes: {}, children: [],
			setAttribute(key, value) { this.attributes[key] = value; },
			appendChild(child) { this.children.push(child); }
		};
		methods.updateSelectionContainerHandleTitle.call(graph, node, cell);
		assert.equal(node.attributes.title, expected);
		assert.equal(node.children.length, 1);
		assert.equal(node.children[0].namespaceURI, 'http://www.w3.org/2000/svg');
		assert.equal(node.children[0].tagName, 'title');
		assert.equal(node.children[0].textContent, expected);
	}
});
