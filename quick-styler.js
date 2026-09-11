/**
 * draw.io Quick Styler Plugin
 */
(function() {
    'use strict';

    var PLUGIN_NAME = 'Quick Styler';
    var STORAGE_KEY = 'drawio-quick-styler-styles';
    var PATCH_VERSION = 2;
    var POPUP_MENU_MARKER = '__quickStylerPopupMenuPatched';

    /**
     * @param {string} message
     */
    function log(message) {
        if (typeof console !== 'undefined' && console.log) {
            console.log(PLUGIN_NAME + ': ' + message);
        }
    }

    /**
     * @param {string} message
     */
    function warn(message) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn(PLUGIN_NAME + ': ' + message);
        }
    }

    /**
     * @returns {boolean}
     */
    function hasDrawPluginLoader() {
        return typeof Draw !== 'undefined' && Draw.loadPlugin != null;
    }

    if (!hasDrawPluginLoader()) {
        warn('Draw.loadPlugin is not available.');
        return;
    }

    var CONFIG = {
        menus: [
            {
                label: 'プロパティ',
                properties: [
                    {
                        key: 'expand',
                        label: '連動してサイズを拡張する',
                        values: [
                            { value: '1' },
                            { value: '0' }
                        ]
                    },
                    {
                        key: 'autosize',
                        label: 'テキストに併せてサイズを調整する',
                        defaultOff: true,
                        values: [
                            { value: '1' },
                            { value: '0' }
                        ]
                    },
                    {
                        key: 'aspect',
                        label: '縦横比を固定する',
                        defaultOff: true,
                        values: [
                            { value: 'fixed' },
                            { value: '0' }
                        ]
                    },
                    {
                        key: 'resizable',
                        label: 'リサイズを禁止する',
                        defaultOff: true,
                        values: [
                            { value: '0' },
                            { value: '1' }
                        ]
                    },
                    {
                        key: 'movable',
                        label: '位置を固定する',
                        defaultOff: true,
                        values: [
                            { value: '0' },
                            { value: '1' }
                        ]
                    },
                    {
                        key: 'container',
                        label: 'コンテナにする',
                        defaultOff: true,
                        values: [
                            { value: '1' },
                            { value: '0' }
                        ]
                    },
                    {
                        key: 'noLabel',
                        label: 'ラベルを隠す',
                        defaultOff: true,
                        values: [
                            { value: '1' },
                            { value: '0' }
                        ]
                    },
                    {
                        key: 'snapToPoint',
                        label: 'ポイントにスナップ',
                        values: [
                            { value: '1' },
                            { value: '0' }
                        ]
                    },
                    {
                        key: 'constraintPoints',
                        label: '接続ポイントを制限する',
                        values: [
                            { value: 'all', label: '上下左右' },
                            { value: 'h', label: '左右' },
                            { value: 'v', label: '上下' },
                            { value: 'none', label: 'なし' }
                        ]
                    },
                    {
                        key: 'allowArrows',
                        label: '矢印を出さない',
                        defaultOff: true,
                        values: [
                            { value: '0' },
                            { value: '1' }
                        ]
                    },
                    {
                        key: 'connectable',
                        label: '接続できなくする',
                        defaultOff: true,
                        values: [
                            { value: '0' },
                            { value: '1' }
                        ]
                    }
                ]
            },
            {
                label: 'スタイル',
                type: 'style'
            }
        ]
    };

    var STYLE_KEYS = Object.create(null);
    ['fillColor', 'strokeColor', 'gradientColor', 'glass',
     'strokeWidth', 'dashed', 'dashPattern', 'rounded',
     'opacity', 'shadow', 'shape', 'perimeter',
     'fontColor', 'fontSize', 'fontFamily', 'fontStyle',
     'align', 'verticalAlign', 'labelPosition',
     'spacingLeft', 'spacingRight', 'spacingTop', 'spacingBottom',
     'whiteSpace', 'overflow',
     'movable', 'resizable', 'rotatable', 'deletable', 'editable',
     'container', 'aspect', 'autosize'
    ].forEach(function(k) { STYLE_KEYS[k] = true; });

    /**
     * @param {mxCell} cell
     * @returns {Object}
     */
    function getStyleValues(cell) {
        var result = {};
        var style = cell.getStyle() || '';

        style.split(';').forEach(function(pair) {
            var idx = pair.indexOf('=');

            if (idx > 0) {
                var k = pair.substring(0, idx);

                if (STYLE_KEYS[k]) {
                    result[k] = pair.substring(idx + 1);
                }
            }
        });
        return result;
    }

    var KEYS_TO_REMOVE = ['glass', 'aspect', 'container'];

    /**
     * @param {mxGraph} graph
     * @param {Array<mxCell>} cells
     * @param {Object} styleObj
     */
    function applyStyleValues(graph, cells, styleObj) {
        graph.getModel().beginUpdate();
        try {
            var keys = Object.keys(styleObj);
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (KEYS_TO_REMOVE.indexOf(k) >= 0 && styleObj[k] === '0') {
                    cells.forEach(function(c) {
                        var s = mxUtils.setStyle(graph.model.getStyle(c), k, null);
                        graph.model.setStyle(c, s);
                    });
                } else {
                    graph.setCellStyles(k, styleObj[k], cells);
                }
            }
        } finally {
            graph.getModel().endUpdate();
        }
        graph.refresh();
    }

    /**
     * @param {mxGraph} graph
     * @param {Array<mxCell>} cells
     * @param {string} key
     */
    function removeStyleKey(graph, cells, key) {
        graph.getModel().beginUpdate();
        try {
            for (var i = 0; i < cells.length; i++) {
                graph.model.setStyle(cells[i], mxUtils.setStyle(graph.model.getStyle(cells[i]), key, null));
            }
        } finally {
            graph.getModel().endUpdate();
        }
        graph.refresh();
    }

    /**
     * @returns {Array<{name: string, style: Object}>}
     */
    function getSavedStyles() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            var styles = raw ? JSON.parse(raw) : [];

            return Array.isArray(styles) ? styles : [];
        } catch (e) {
            warn('Failed to read saved styles: ' + e);
            return [];
        }
    }

    /**
     * @param {Array<{name: string, style: Object}>} styles
     */
    function setSavedStyles(styles) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
        } catch (e) {
            warn('Failed to save styles to localStorage: ' + e);
        }
    }

    /**
     * @param {string} name
     * @param {Object} styleObj
     */
    function saveStyle(name, styleObj) {
        var styles = getSavedStyles();
        for (var i = 0; i < styles.length; i++) {
            if (styles[i].name === name) {
                styles[i].style = styleObj;
                setSavedStyles(styles);
                log('style saved: ' + name);
                return;
            }
        }
        styles.push({ name: name, style: styleObj });
        setSavedStyles(styles);
        log('style saved: ' + name);
    }

    /**
     * @param {string} name
     */
    function deleteSavedStyle(name) {
        var styles = getSavedStyles().filter(function(item) {
            return item.name !== name;
        });
        setSavedStyles(styles);
        log('style deleted: ' + name);
    }

    /**
     * @param {mxGraph} graph
     * @param {string} key
     * @param {string} value
     */
    function setProp(graph, key, value) {
        var cells = graph.getSelectionCells();
        if (cells.length === 0) return;

        if (key === 'constraintPoints') {
            var points = CONSTRAINT_PRESETS[value];
            graph.getModel().beginUpdate();
            try {
                for (var i = 0; i < cells.length; i++) {
                    if (graph.model.isVertex(cells[i])) {
                        graph.model.setStyle(cells[i], mxUtils.setStyle(graph.model.getStyle(cells[i]), 'points', points));
                    }
                }
            } finally {
                graph.getModel().endUpdate();
            }
            graph.refresh();
            return;
        }

        if (KEYS_TO_REMOVE.indexOf(key) >= 0 && value === '0') {
            removeStyleKey(graph, cells, key);
            return;
        }

        graph.setCellStyles(key, value, cells);
        graph.refresh();
    }

    /**
     * @param {mxGraph} graph
     * @param {mxCell} cell
     * @param {string} key
     * @returns {string|null}
     */
    function getCurrentVal(graph, cell, key) {
        var resolved = graph.getCellStyle(cell);
        if (resolved[key]) return resolved[key];
        var match = cell.getStyle().match(new RegExp('(?:^|;)' + key + '=([^;]*)'));
        return match ? match[1] : null;
    }

    var CONSTRAINT_PRESETS = {
        'all': '[[0.5,0],[1,0.5],[0.5,1],[0,0.5]]',
        'v': '[[0.5,0],[0.5,1]]',
        'h': '[[0,0.5],[1,0.5]]',
        'none': null
    };

    var CONSTRAINT_PRESETS_REV = {
        '[[0.5,0],[1,0.5],[0.5,1],[0,0.5]]': 'all',
        '[[0.5,0],[0.5,1]]': 'v',
        '[[0,0.5],[1,0.5]]': 'h'
    };

    /**
     * @param {mxGraph} graph
     * @param {mxCell} cell
     * @returns {string}
     */
    function getConstraintPreset(graph, cell) {
        var raw = getCurrentVal(graph, cell, 'points');
        if (!raw) return 'none';
        return CONSTRAINT_PRESETS_REV[raw.replace(/\s/g, '')] || 'none';
    }

    /**
     * @param {mxGraph} graph
     * @param {mxCell} cell
     */
    function showStyleDialog(graph, cell) {
        function save() {
            var name = input.value.trim();
            if (name) {
                saveStyle(name, getStyleValues(cell));
                input.value = '';
                refreshDatalist();
            }
        }

        function close() {
            document.body.removeChild(overlay);
        }

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';

        var dialog = document.createElement('div');
        dialog.style.cssText = 'background:#fff;border-radius:6px;padding:20px;min-width:280px;max-width:340px;box-shadow:0 4px 16px rgba(0,0,0,0.2);max-height:80vh;overflow-y:auto;position:relative;';

        var closeTop = document.createElement('button');
        closeTop.textContent = '\u2715';
        closeTop.title = '閉じる';
        closeTop.style.cssText = 'position:absolute;top:8px;right:10px;padding:0;border:none;background:none;font-size:14px;color:#9ca3af;cursor:pointer;line-height:1;';
        closeTop.onclick = close;
        dialog.appendChild(closeTop);

        var titleEl = document.createElement('div');
        titleEl.textContent = 'スタイルを管理';
        titleEl.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:12px;color:#1f2937;padding-right:16px;';
        dialog.appendChild(titleEl);

        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '名前を入力';
        input.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:13px;box-sizing:border-box;margin-bottom:10px;';

        var datalistId = 'quick-styler-datalist';
        var datalist = document.createElement('datalist');
        datalist.id = datalistId;

        function refreshDatalist() {
            while (datalist.firstChild) {
                datalist.removeChild(datalist.firstChild);
            }
            getSavedStyles().forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.name;
                datalist.appendChild(opt);
            });
        }

        dialog.appendChild(datalist);
        refreshDatalist();
        input.setAttribute('list', datalistId);
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') close();
        });
        dialog.appendChild(input);

        var buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display:flex;gap:6px;';

        var saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = 'flex:1;padding:6px 14px;border:none;border-radius:4px;background:#2563eb;color:#fff;font-size:12px;cursor:pointer;';
        saveBtn.onclick = save;
        buttonRow.appendChild(saveBtn);

        var delBtn = document.createElement('button');
        delBtn.textContent = '削除';
        delBtn.style.cssText = 'flex:1;padding:6px 14px;border:1px solid #ef4444;border-radius:4px;background:#fff;color:#ef4444;font-size:12px;cursor:pointer;';
        delBtn.onclick = function() {
            var name = input.value.trim();
            if (name) {
                deleteSavedStyle(name);
                input.value = '';
                input.focus();
                refreshDatalist();
            }
        };
        buttonRow.appendChild(delBtn);

        dialog.appendChild(buttonRow);

        overlay.appendChild(dialog);

        overlay.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') close();
        });

        document.body.appendChild(overlay);
        setTimeout(function() { input.focus(); }, 50);
    }

    /**
     * @param {Object} menu
     * @param {mxGraph} graph
     * @param {mxCell} cell
     */
    function buildStyleMenu(menu, graph, cell) {
        var styleParent = menu.addItem(CONFIG.menus[1].label, null, null);

        menu.addItem('スタイルを管理', null, function() {
            showStyleDialog(graph, cell);
        }, styleParent);

        var savedStyles = getSavedStyles();
        if (savedStyles.length > 0) {
            menu.addSeparator(styleParent);
            savedStyles.forEach(function(item) {
                menu.addItem(item.name, null, function() {
                    applyStyleValues(graph, graph.getSelectionCells(), item.style);
                }, styleParent);
            });
        }
    }

    Draw.loadPlugin(function(ui) {
        var graph = ui.editor.graph;
        var menus = ui.menus;

        if (menus == null || menus.createPopupMenu == null) {
            warn('Popup menu hook is not available.');
            return;
        }

        var previousPatch = menus[POPUP_MENU_MARKER];
        var originalCreatePopupMenu =
            previousPatch != null && previousPatch.createPopupMenu != null ?
                previousPatch.createPopupMenu :
                menus.createPopupMenu;

        menus[POPUP_MENU_MARKER] = {
            version: PATCH_VERSION,
            createPopupMenu: originalCreatePopupMenu
        };

        function addCheckableItem(menu, label, checked, action, parent) {
            var item = menu.addItem(label, null, action, parent);
            if (checked) {
                menu.addCheckmark(item, Editor.checkmarkImage);
            }
            return item;
        }

        menus.createPopupMenu = function(menu, cell, evt) {
            if (cell != null && graph.model.isVertex(cell)) {

                CONFIG.menus.forEach(function(menuGroup) {
                    if (menuGroup.type === 'style') {
                        buildStyleMenu(menu, graph, cell);
                        return;
                    }

                    var parentItem = menu.addItem(menuGroup.label, null, null);

                    menuGroup.properties.forEach(function(prop) {
                        if (prop.values.length === 2) {
                            var cur = getCurrentVal(graph, cell, prop.key);
                            var checked = (cur == null) ? !prop.defaultOff : (cur !== prop.values[1].value);
                            addCheckableItem(menu, prop.label, checked, function() {
                                setProp(graph, prop.key, checked ? prop.values[1].value : prop.values[0].value);
                            }, parentItem);
                        } else {
                            var propItem = menu.addItem(prop.label, null, null, parentItem);
                            var currentPreset = (prop.key === 'constraintPoints') ? getConstraintPreset(graph, cell) : null;
                            prop.values.forEach(function(val) {
                                addCheckableItem(menu, val.label, val.value === currentPreset, function() {
                                    setProp(graph, prop.key, val.value);
                                }, propItem);
                            });
                        }
                    });
                });

                menu.addSeparator();
            }

            originalCreatePopupMenu.call(menus, menu, cell, evt);
        };

        var totalProps = CONFIG.menus.reduce(function(acc, m) {
            return acc + (m.properties ? m.properties.length : 0);
        }, 0);
        log('loaded (' + totalProps + ' properties)');
    });
})();
