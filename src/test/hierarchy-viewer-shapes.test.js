import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const pluginSource = readFileSync(
	new URL('../../drawio/src/main/webapp/plugins/hierarchy-viewer.js', import.meta.url),
	'utf8'
);

function setupScope() {
	const start = pluginSource.indexOf('var shapeNames = {');
	assert.notEqual(start, -1);
	const end = pluginSource.indexOf('function change(fn)', start);
	assert.notEqual(end, -1);

	const code = pluginSource.slice(start, end);

	const mockContext = {
		mxUtils: {
			getStylenames: style => {
				if (style != null && style.length > 0) {
					const pairs = style.split(';');
					const stylenames = [];
					for (let i = 0; i < pairs.length; i++) {
						const tmp = pairs[i];
						const pos = tmp.indexOf('=');
						if (pos < 0 && tmp.length > 0) {
							stylenames.push(tmp);
						}
					}
					return stylenames;
				}
				return [];
			},
			indexOf: (array, value) => {
				if (array != null) {
					for (let i = 0; i < array.length; i++) {
						if (array[i] === value) return i;
					}
				}
				return -1;
			},
			extractTextWithWhitespace: () => ''
		},
		model: {
			getStyle: cell => cell?.style,
			isLayer: cell => Boolean(cell?.isLayer),
			isEdge: cell => Boolean(cell?.isEdge),
			getTerminal: (cell, isSource) => isSource ? cell?.source : cell?.target
		},
		graph: {
			getCellStyle: cell => cell?.computedStyle || {},
			convertValueToString: cell => cell?.value ?? '',
			isReplacePlaceholders: () => false,
			isHtmlLabel: () => false
		},
		document: {
			createElement: () => ({
				childNodes: []
			})
		},
		Graph: {
			sanitizeHtml: s => s
		},
		Set: globalThis.Set
	};

	vm.runInNewContext(code + '\nthis.getShapeName = getShapeName;\nthis.label = label;', mockContext);
	return mockContext;
}

test('hierarchy-viewer getShapeName correctly resolves standard draw.io shapes', () => {
	const {getShapeName} = setupScope();

	// In draw.io, vertices inherit shape='label' from defaultVertex
	const cases = [
		{
			title: 'Rectangle (default vertex)',
			cell: {
				id: 'rect1',
				style: 'rounded=0;whiteSpace=wrap;html=1;',
				computedStyle: {shape: 'label', rounded: '0'}
			},
			expected: '四角形'
		},
		{
			title: 'Rounded Rectangle',
			cell: {
				id: 'rrect1',
				style: 'rounded=1;whiteSpace=wrap;html=1;',
				computedStyle: {shape: 'label', rounded: '1'}
			},
			expected: '角丸四角形'
		},
		{
			title: 'Square',
			cell: {
				id: 'sq1',
				style: 'whiteSpace=wrap;html=1;aspect=fixed;',
				computedStyle: {shape: 'label', aspect: 'fixed'}
			},
			expected: '正方形'
		},
		{
			title: 'Rounded Square',
			cell: {
				id: 'rsq1',
				style: 'rounded=1;whiteSpace=wrap;html=1;aspect=fixed;',
				computedStyle: {shape: 'label', rounded: '1', aspect: 'fixed'}
			},
			expected: '角丸正方形'
		},
		{
			title: 'Text element',
			cell: {
				id: 'txt1',
				style: 'text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;',
				computedStyle: {shape: 'label'}
			},
			expected: 'テキスト'
		},
		{
			title: 'Ellipse',
			cell: {
				id: 'el1',
				style: 'ellipse;whiteSpace=wrap;html=1;shapeInside=1;',
				computedStyle: {shape: 'ellipse'}
			},
			expected: '楕円'
		},
		{
			title: 'Circle',
			cell: {
				id: 'circ1',
				style: 'ellipse;whiteSpace=wrap;html=1;shapeInside=1;aspect=fixed;',
				computedStyle: {shape: 'ellipse', aspect: 'fixed'}
			},
			expected: '円'
		},
		{
			title: 'Rhombus / Diamond',
			cell: {
				id: 'rhomb1',
				style: 'rhombus;whiteSpace=wrap;html=1;shapeInside=1;',
				computedStyle: {shape: 'rhombus'}
			},
			expected: '菱形'
		},
		{
			title: 'Triangle',
			cell: {
				id: 'tri1',
				style: 'triangle;whiteSpace=wrap;html=1;shapeInside=1;',
				computedStyle: {shape: 'triangle'}
			},
			expected: '三角形'
		},
		{
			title: 'Process',
			cell: {
				id: 'proc1',
				style: 'shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;',
				computedStyle: {shape: 'process'}
			},
			expected: 'プロセス'
		},
		{
			title: 'Cylinder',
			cell: {
				id: 'cyl1',
				style: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;',
				computedStyle: {shape: 'cylinder3'}
			},
			expected: '円柱'
		},
		{
			title: 'Cloud',
			cell: {
				id: 'cloud1',
				style: 'ellipse;shape=cloud;whiteSpace=wrap;html=1;',
				computedStyle: {shape: 'cloud'}
			},
			expected: '雲'
		},
		{
			title: 'Group',
			cell: {
				id: 'grp1',
				style: 'group',
				computedStyle: {shape: 'label'}
			},
			expected: 'グループ'
		},
		{
			title: 'Line',
			cell: {
				id: 'ln1',
				style: 'line;strokeWidth=2;html=1;',
				computedStyle: {shape: 'line'}
			},
			expected: '直線'
		},
		{
			title: 'Swimlane',
			cell: {
				id: 'sw1',
				style: 'swimlane;whiteSpace=wrap;html=1;',
				computedStyle: {shape: 'swimlane'}
			},
			expected: 'コンテナ'
		},
		{
			title: 'Actor',
			cell: {
				id: 'act1',
				style: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;',
				computedStyle: {shape: 'umlActor'}
			},
			expected: 'アクター'
		},
		{
			title: 'Custom Cisco Router',
			cell: {
				id: 'rtr1',
				style: 'shape=mxgraph.cisco.router;html=1;',
				computedStyle: {shape: 'mxgraph.cisco.router'}
			},
			expected: 'Router'
		}
	];

	for (const tc of cases) {
		const result = getShapeName(tc.cell);
		assert.equal(result, tc.expected, `${tc.title}: expected "${tc.expected}", got "${result}"`);
	}
});

test('hierarchy-viewer label function provides proper fallback names with IDs', () => {
	const {label} = setupScope();

	// Empty rectangle with simple ID
	const rectCell = {
		id: '2',
		value: '',
		style: 'rounded=0;whiteSpace=wrap;html=1;',
		computedStyle: {shape: 'label', rounded: '0'}
	};
	assert.equal(label(rectCell), '四角形 2');

	// Empty rectangle with draw.io prefixed ID (e.g. MLTkatxYahb7iSvuU0QN-5)
	const prefixedRectCell = {
		id: 'MLTkatxYahb7iSvuU0QN-5',
		value: '',
		style: 'rounded=0;whiteSpace=wrap;html=1;',
		computedStyle: {shape: 'label', rounded: '0'}
	};
	assert.equal(label(prefixedRectCell), '四角形 5');

	// Rectangle with value
	const labeledRect = {
		id: '3',
		value: 'My Box',
		style: 'rounded=0;whiteSpace=wrap;html=1;',
		computedStyle: {shape: 'label', rounded: '0'}
	};
	assert.equal(label(labeledRect), 'My Box');

	// Empty group
	const groupCell = {
		id: '4',
		value: '',
		style: 'group',
		computedStyle: {shape: 'label'}
	};
	assert.equal(label(groupCell), 'グループ 4');

	// Empty text
	const textCell = {
		id: '5',
		value: '',
		style: 'text;html=1;whiteSpace=wrap;strokeColor=none;fillColor=none;',
		computedStyle: {shape: 'label'}
	};
	assert.equal(label(textCell), 'テキスト 5');

	// Empty layer
	const layerCell = {
		id: '1',
		value: '',
		isLayer: true
	};
	assert.equal(label(layerCell), 'レイヤー 1');

	// Empty edge between labeled cells
	const edgeCell = {
		id: '6',
		value: '',
		isEdge: true,
		source: labeledRect,
		target: rectCell
	};
	assert.equal(label(edgeCell), 'My Box → 四角形 2');
});

test('hierarchy-viewer defines eye and eye-off SVG icons for visibility toggle', () => {
	assert.ok(pluginSource.includes('var eyeSvg ='), 'eyeSvg should be defined');
	assert.ok(pluginSource.includes('var eyeOffSvg ='), 'eyeOffSvg should be defined');
	assert.ok(pluginSource.includes('visIcon = selfVisible ? eyeSvg : eyeOffSvg'), 'visIcon toggles between eyeSvg and eyeOffSvg');
	assert.ok(pluginSource.includes("content.charAt(0) === '<'"), 'button supports HTML/SVG content');
});

test('hierarchy-viewer supports double click on label and row to trigger rename', () => {
	assert.ok(pluginSource.includes('labelSpan.ondblclick = function(evt)'), 'labelSpan has ondblclick handler');
	assert.ok(pluginSource.includes('row.ondblclick = function(evt)'), 'row has ondblclick handler');
});

test('hierarchy-viewer stretches layer row content and does not stretch checkbox', () => {
	assert.ok(pluginSource.includes('.geHierarchyRow input:not([type="checkbox"])'), 'checkbox input is excluded from 100% width');
	assert.ok(pluginSource.includes("cb.style.width = 'auto'"), 'cb width is explicitly auto');
	assert.ok(pluginSource.includes("cb.style.flexShrink = '0'"), 'cb flexShrink is 0');
	assert.ok(pluginSource.includes("contentDiv.style.flex = '1'"), 'contentDiv flex is 1 to stretch across row');
	assert.ok(pluginSource.includes("title.style.flex = '1'"), 'layer title flex is 1 to stretch inside contentDiv');
});

test('hierarchy-viewer collapses multiline edge labels and terminal names into single line', () => {
	const {label} = setupScope();
	const multilineSource = {
		id: '10',
		value: 'Server\n(Primary)',
		style: 'rounded=0;',
		computedStyle: {shape: 'rectangle'}
	};
	const multilineTarget = {
		id: '11',
		value: 'Database\r\nCluster',
		style: 'rounded=0;',
		computedStyle: {shape: 'cylinder'}
	};
	const edgeWithMultilineTerminals = {
		id: '12',
		value: '',
		isEdge: true,
		source: multilineSource,
		target: multilineTarget
	};
	assert.equal(label(edgeWithMultilineTerminals), 'Server (Primary) → Database Cluster');

	const edgeWithMultilineLabel = {
		id: '13',
		value: 'TCP\nConnection\n(Port 80)',
		isEdge: true,
		source: multilineSource,
		target: multilineTarget
	};
	assert.equal(label(edgeWithMultilineLabel), 'TCP Connection (Port 80)');
});

test('hierarchy-viewer expands layers by default without one-time boolean flag', () => {
	assert.ok(pluginSource.includes('var collapsedLayers = new Set();'), 'collapsedLayers set is defined');
	assert.ok(!pluginSource.includes('defaultExpandedInitialized'), 'flaky defaultExpandedInitialized flag is removed');
	assert.ok(pluginSource.includes('var isExpanded = !collapsedLayers.has(child.id);'), 'layers expand by default unless collapsed');
});

test('hierarchy-viewer installs window persistence when replacing pre-existing LayersWindow', () => {
	assert.ok(pluginSource.includes("ui.installWindowPersistence('layers', ui.actions.layersWindow)"), 'persistence reinstalled on replace');
});
