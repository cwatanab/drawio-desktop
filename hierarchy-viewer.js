/**
 * draw.io Hierarchy Viewer Plugin
 */
(function() {
    'use strict';

    var PLUGIN_NAME = 'Hierarchy Viewer';
    var STORAGE_KEY = 'drawio-hierarchy-viewer-state';
    var STYLE_ELEMENT_ID = 'drawio-hierarchy-viewer-styles';
    var ACTION_NAME = 'toggleHierarchyViewer';
    var PATCH_VERSION = 2;
    var MENU_PATCH_MARKER = '__hierarchyViewerMenuPatched';
    var GRAPH_LISTENER_MARKER = '__hierarchyViewerGraphListeners';

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

    /**
     * @param {string} id
     * @param {string} cssText
     */
    function ensureStyleElement(id, cssText) {
        var style = document.getElementById(id);

        if (style == null) {
            style = document.createElement('style');
            style.id = id;
            style.type = 'text/css';
            (document.head || document.getElementsByTagName('head')[0]).appendChild(style);
        }

        style.textContent = cssText;
    }

    /**
     * @param {Object} source
     * @param {Function} listener
     */
    function removeListener(source, listener) {
        if (source != null &&
            listener != null &&
            typeof source.removeListener === 'function') {
            source.removeListener(listener);
        }
    }

    if (!hasDrawPluginLoader()) {
        warn('Draw.loadPlugin is not available.');
        return;
    }

    Draw.loadPlugin(function(ui) {
        var graph = ui.editor.graph;
        
        var menuLabel = '階層・オブジェクトビューア';
        var windowTitle = 'オブジェクト階層';
        
        try {
            // Create window DOM container
            var container = document.createElement('div');
            container.style.cssText = 'width:100%;height:100%;overflow:auto;padding:8px;box-sizing:border-box;font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-size:12px;background-color:#fff;user-select:none;outline:none;';
            container.tabIndex = 0;

            // Add CSS styling including Drag and Drop visual indicators
            ensureStyleElement(STYLE_ELEMENT_ID, [
                '.hierarchy-item { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; display: flex; align-items: center; justify-content: space-between; transition: border 0.1s, background-color 0.1s; outline: none; }',
                '.hierarchy-item:hover { background-color: #f3f4f6; }',
                '.hierarchy-item-selected { background-color: #dbeafe !important; border-left: 3px solid #2563eb; }',
                '.hierarchy-item-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1; display: flex; align-items: center; cursor: pointer; }',
                '.hierarchy-drag-handle { cursor: grab; padding: 0 4px; color: #9ca3af; font-family: sans-serif; font-size: 14px; user-select: none; margin-right: 4px; flex-shrink: 0; }',
                '.hierarchy-drag-handle:active { cursor: grabbing; }',
                '.hierarchy-vis-btn { cursor: pointer; margin-right: 6px; display: inline-flex; align-items: center; justify-content: center; user-select: none; flex-shrink: 0; transition: opacity 0.15s, color 0.15s; }',
                '.hierarchy-vis-btn:hover { opacity: 1.0 !important; color: #2563eb !important; }',
                '.hierarchy-rename-btn { cursor: pointer; font-size: 12px; margin-left: 6px; user-select: none; flex-shrink: 0; transition: opacity 0.1s; }',
                '.hierarchy-item-badge { font-size: 10px; color: #9ca3af; background-color: #f3f4f6; padding: 1px 4px; border-radius: 4px; margin-left: 6px; flex-shrink: 0; }',
                '.hierarchy-children { margin-left: 12px; border-left: 1px dashed #e5e7eb; }',
                '.drag-over-inside { background-color: #bfdbfe !important; }',
                '.drag-over-before { border-top: 2px solid #2563eb !important; }',
                '.drag-over-after { border-bottom: 2px solid #2563eb !important; }'
            ].join('\n'));

            // Create mxWindow
            var wnd = new mxWindow(windowTitle, container, 200, 100, 280, 420, true, true);
            wnd.setResizable(true);
            wnd.setScrollable(false); // Scroll handled by container div

            var WINDOW_EL_CANDIDATES = [wnd.div, wnd.table, wnd.contentDiv];

            function saveSettings() {
                try {
                    var el;
                    for (var i = 0; i < WINDOW_EL_CANDIDATES.length; i++) {
                        var c = WINDOW_EL_CANDIDATES[i];
                        if (c && c.style &&
                            !isNaN(parseInt(c.style.left, 10)) &&
                            !isNaN(parseInt(c.style.top, 10))) {
                            el = c;
                            break;
                        }
                    }
                    if (!el) return;
                    var state = {
                        visible: wnd.isVisible(),
                        x: parseInt(el.style.left, 10),
                        y: parseInt(el.style.top, 10),
                        w: el.offsetWidth,
                        h: el.offsetHeight
                    };
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
                } catch (e) { warn('Failed to save window state: ' + e); }
            }

            function restoreSettings() {
                try {
                    var json = localStorage.getItem(STORAGE_KEY);
                    if (!json) return false;
                    var state = JSON.parse(json);
                    if (state == null || typeof state !== 'object') return false;
                    if (!state.visible) return false;
                    wnd.setVisible(true);
                    if (typeof state.x === 'number' && typeof state.y === 'number') {
                        wnd.setLocation(state.x, state.y);
                    }
                    if (typeof state.w === 'number' && typeof state.h === 'number') {
                        wnd.setSize(state.w, state.h);
                    }
                    return true;
                } catch (e) {
                    warn('Failed to restore window state: ' + e);
                    return false;
                }
            }

            try {
                wnd.addListener('move', saveSettings);
                wnd.addListener('resize', saveSettings);
            } catch (e) { warn('Failed to register window listeners: ' + e); }

            // SVG icon definitions (Lucide icons style)
            var openEyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
            var closedEyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

            // Drag state (closure-scoped instead of window global)
            var draggedCell = null;

            /**
             * @param {mxCell} parent
             * @param {mxCell} child
             * @returns {boolean}
             */
            function isDescendant(parent, child) {
                for (var node = child; node != null; node = node.getParent()) {
                    if (node === parent) return true;
                }
                return false;
            }

            /**
             * @param {Element} [exceptItem]
             */
            function clearDragOverStyles(exceptItem) {
                var items = container.querySelectorAll('.hierarchy-item');
                for (var i = 0; i < items.length; i++) {
                    if (items[i] !== exceptItem) {
                        items[i].classList.remove('drag-over-before', 'drag-over-after', 'drag-over-inside');
                    }
                }
            }

            /**
             * @param {mxCell} cell
             * @returns {string}
             */
            function getRawCellLabel(cell) {
                if (!cell.value) return '';
                if (typeof cell.value === 'object' && cell.value.getAttribute) {
                    return cell.value.getAttribute('label') || '';
                }
                return String(cell.value);
            }

            /**
             * @param {mxCell} cell
             * @returns {string}
             */
            function getCellLabel(cell) {
                var raw = getRawCellLabel(cell);
                if (raw) return raw;
                if (graph.model.isEdge(cell)) {
                    var source = cell.getTerminal(true);
                    var target = cell.getTerminal(false);
                    return (source ? getCellLabel(source) : '?') + ' → ' + (target ? getCellLabel(target) : '?');
                }
                return '[図形 ' + (cell.id || '') + ']';
            }

            /**
             * @param {Event} e
             * @param {Element} itemEl
             * @param {boolean} isLayer
             * @param {mxCell} targetCell
             * @returns {string} 'before' | 'after' | 'inside'
             */
            function getDropPosition(e, itemEl, isLayer, targetCell) {
                var rect = itemEl.getBoundingClientRect();
                var y = e.clientY - rect.top;
                var pct = y / rect.height;
                if (pct < 0.3) return 'before';
                if (pct > 0.7) return 'after';
                if (isLayer || graph.model.isEdge(targetCell)) return pct < 0.5 ? 'before' : 'after';
                return 'inside';
            }

            /**
             * @param {mxCell} cell
             * @param {Element} dragHandle
             * @param {Element} labelSpan
             * @param {Element} rightContainer
             * @param {string} prefix
             * @returns {Function} startEditing trigger function
             */
            function setupRename(cell, dragHandle, labelSpan, rightContainer, prefix) {
                return function startEditing() {
                    function setDragState(editing) {
                        dragHandle.setAttribute('draggable', String(!editing));
                        dragHandle.style.opacity = editing ? '0.3' : '1';
                        dragHandle.style.cursor = editing ? 'default' : 'move';
                        rightContainer.style.display = editing ? 'none' : 'flex';
                    }
                    setDragState(true);

                    var currentText = getRawCellLabel(cell);

                    var input = document.createElement('input');
                    input.type = 'text';
                    input.value = currentText;
                    input.style.cssText = 'width:100%;box-sizing:border-box;padding:2px 4px;font-size:12px;border:1px solid #3b82f6;border-radius:3px;outline:none;margin:0 4px;';

                    labelSpan.innerHTML = '';
                    labelSpan.textContent = prefix;
                    labelSpan.appendChild(input);

                    input.focus();
                    input.select();

                    var isFinished = false;
                    function finishEdit(save) {
                        if (isFinished) return;
                        isFinished = true;

                        var newValue = input.value.trim();
                        if (save && newValue !== currentText) {
                            graph.getModel().beginUpdate();
                            try {
                                graph.cellLabelChanged(cell, newValue);
                            } catch (err) {
                                warn('Failed to change label: ' + err);
                            } finally {
                                graph.getModel().endUpdate();
                            }
                        }

                        setDragState(false);
                        refreshTree();
                        container.focus();
                    }

                    input.onblur = function() { finishEdit(true); };
                    input.onkeydown = function(evt) {
                        if (evt.key === 'Enter') finishEdit(true);
                        else if (evt.key === 'Escape') finishEdit(false);
                    };
                };
            }

            /**
             * @param {Element} item
             * @param {mxCell} cell
             * @param {Element} dragHandle
             * @param {boolean} isLayer
             */
            function setupDragDrop(item, cell, dragHandle, isLayer) {
                dragHandle.setAttribute('draggable', 'true');

                dragHandle.ondragstart = function(e) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', cell.id);
                    draggedCell = cell;
                    item.style.opacity = '0.5';
                };

                dragHandle.ondragend = function() {
                    item.style.opacity = '1';
                    draggedCell = null;
                    clearDragOverStyles();
                };

                item.ondragover = function(e) {
                    if (!draggedCell || isDescendant(draggedCell, cell)) return;
                    if (isLayer && draggedCell.getParent() !== cell.getParent()) return;

                    e.preventDefault();
                    clearDragOverStyles(item);
                    item.classList.add('drag-over-' + getDropPosition(e, item, isLayer, cell));
                };

                item.ondragleave = function() {
                    item.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-inside');
                };

                item.ondrop = function(e) {
                    if (!draggedCell) return;
                    e.preventDefault();

                    var insertMode = getDropPosition(e, item, isLayer, cell);
                    var parent = (insertMode === 'inside') ? cell : cell.getParent();
                    var index;

                    graph.getModel().beginUpdate();
                    try {
                        if (insertMode === 'inside') {
                            index = parent.getChildCount();
                        } else {
                            var targetIndex = cell.getParent().children.indexOf(cell);
                            var draggedIndex = draggedCell.getParent().children.indexOf(draggedCell);

                            if (draggedCell.getParent() === parent) {
                                index = (insertMode === 'before')
                                    ? (draggedIndex > targetIndex ? targetIndex + 1 : targetIndex)
                                    : (draggedIndex < targetIndex ? targetIndex - 1 : targetIndex);
                                if (index < 0) index = 0;
                            } else {
                                index = (insertMode === 'before') ? targetIndex + 1 : targetIndex;
                            }
                        }
                        graph.addCells([draggedCell], parent, index);
                    } catch (err) {
                        warn('Failed to move cell: ' + err);
                    } finally {
                        graph.getModel().endUpdate();
                    }

                    clearDragOverStyles();
                    refreshTree();
                };
            }

            /**
             * @param {mxCell} cell
             * @param {boolean} isLayer
             * @param {boolean} isSelected
             * @returns {Element}
             */
            function createItemDom(cell, isLayer, isSelected) {
                var item = document.createElement('div');
                item.className = 'hierarchy-item' + (isSelected ? ' hierarchy-item-selected' : '');

                // Drag Handle
                var dragHandle = document.createElement('span');
                dragHandle.className = 'hierarchy-drag-handle';
                dragHandle.textContent = '⋮⋮';
                dragHandle.title = 'ドラッグして順序・階層を移動';
                item.appendChild(dragHandle);

                // Visibility Toggle
                var visBtn = document.createElement('span');
                visBtn.className = 'hierarchy-vis-btn';
                function updateVisBtn() {
                    var v = graph.model.isVisible(cell);
                    visBtn.innerHTML = v ? openEyeSvg : closedEyeSvg;
                    visBtn.style.opacity = v ? '0.7' : '0.35';
                    visBtn.style.color = v ? '#4b5563' : '#9ca3af';
                    visBtn.title = v ? 'クリックして非表示にする' : 'クリックして表示する';
                }
                updateVisBtn();
                visBtn.onclick = function(e) {
                    e.stopPropagation();
                    graph.getModel().beginUpdate();
                    try {
                        graph.model.setVisible(cell, !graph.model.isVisible(cell));
                    } finally {
                        graph.getModel().endUpdate();
                    }
                    graph.refresh();
                    refreshTree();
                };
                item.appendChild(visBtn);

                // Icon prefix based on cell type
                var prefix;
                if (isLayer) {
                    prefix = '🗂️ ';
                    item.style.fontWeight = 'bold';
                    item.style.backgroundColor = '#f9fafb';
                } else if (graph.model.isEdge(cell)) {
                    prefix = '⚡ ';
                    item.style.color = '#4b5563';
                } else {
                    prefix = '⬜ ';
                }

                // Label
                var labelSpan = document.createElement('span');
                labelSpan.className = 'hierarchy-item-label';
                labelSpan.textContent = prefix + getCellLabel(cell);
                item.appendChild(labelSpan);

                // Right side container for badges and actions
                var rightContainer = document.createElement('div');
                rightContainer.style.display = 'flex';
                rightContainer.style.alignItems = 'center';
                rightContainer.style.flexShrink = '0';

                var renameBtn = document.createElement('span');
                renameBtn.className = 'hierarchy-rename-btn';
                renameBtn.textContent = '✏️';
                renameBtn.style.opacity = '0.4';
                renameBtn.title = '名前を変更 (F2 キーでも変更可能)';
                renameBtn.onmouseover = function() { renameBtn.style.opacity = '1.0'; };
                renameBtn.onmouseout = function() { renameBtn.style.opacity = '0.4'; };
                rightContainer.appendChild(renameBtn);

                // Z-Order Badge
                var parent = cell.getParent();
                if (parent && parent.children && !isLayer) {
                    var idx = parent.children.indexOf(cell);
                    var total = parent.children.length;
                    var zBadge = document.createElement('span');
                    zBadge.className = 'hierarchy-item-badge';
                    zBadge.textContent = 'Z:' + idx + '/' + (total - 1);
                    zBadge.title = '重なり順 (インデックスが大きいほど前面)';
                    rightContainer.appendChild(zBadge);
                }

                item.appendChild(rightContainer);

                var defaultBg = isLayer ? '#f9fafb' : 'transparent';
                item.onmouseover = function() {
                    if (graph.getSelectionCell() !== cell) item.style.backgroundColor = '#f3f4f6';
                };
                item.onmouseout = function() {
                    if (graph.getSelectionCell() !== cell) item.style.backgroundColor = defaultBg;
                };

                // Click to select
                item.onclick = function(e) {
                    e.stopPropagation();
                    graph.setSelectionCell(cell);
                    graph.scrollCellToVisible(cell);
                    container.focus();
                };

                // Inline rename
                var startEditing = setupRename(cell, dragHandle, labelSpan, rightContainer, prefix);
                item._startEditing = startEditing;
                renameBtn.onclick = function(e) {
                    e.stopPropagation();
                    startEditing();
                };

                // Drag & Drop
                setupDragDrop(item, cell, dragHandle, isLayer);

                return item;
            }

            /**
             * @param {mxCell} cell
             * @param {number} depth
             * @param {boolean} isSelected
             * @returns {Element}
             */
            function buildTreeDom(cell, depth, isSelected) {
                var wrapper = document.createElement('div');

                if (depth > 0) {
                    wrapper.appendChild(createItemDom(cell, depth === 1, isSelected));
                }

                // Recurse into children (reverse Z-order: highest index on top)
                var childCount = cell.getChildCount();
                if (childCount > 0) {
                    var childrenContainer = document.createElement('div');
                    childrenContainer.className = 'hierarchy-children';
                    for (var i = childCount - 1; i >= 0; i--) {
                        var child = cell.getChildAt(i);
                        var isChildSelected = (graph.getSelectionCell() === child);
                        childrenContainer.appendChild(buildTreeDom(child, depth + 1, isChildSelected));
                    }
                    wrapper.appendChild(childrenContainer);
                }

                return wrapper;
            }

            /**
             * Render the hierarchy tree.
             */
            function refreshTree() {
                container.innerHTML = '';
                var root = graph.getModel().getRoot();
                if (root) {
                    container.appendChild(buildTreeDom(root, 0, false));
                } else {
                    container.textContent = 'オブジェクトが見つかりません。';
                }
            }

            // Listen for keydown (F2) on the container to trigger editing
            container.addEventListener('keydown', function(e) {
                if (e.key === 'F2') {
                    var selectedItem = container.querySelector('.hierarchy-item-selected');
                    if (selectedItem && typeof selectedItem._startEditing === 'function') {
                        e.preventDefault();
                        e.stopPropagation();
                        selectedItem._startEditing();
                    }
                }
            });

            function refreshIfVisible() {
                if (wnd.isVisible()) refreshTree();
            }

            var previousGraphListeners = graph[GRAPH_LISTENER_MARKER];

            if (previousGraphListeners != null) {
                removeListener(graph.getModel(), previousGraphListeners.refreshIfVisible);
                removeListener(graph.getSelectionModel(), previousGraphListeners.refreshIfVisible);
            }

            graph.getModel().addListener(mxEvent.CHANGE, refreshIfVisible);
            graph.getSelectionModel().addListener(mxEvent.CHANGE, refreshIfVisible);

            graph[GRAPH_LISTENER_MARKER] = {
                version: PATCH_VERSION,
                refreshIfVisible: refreshIfVisible
            };

            /**
             * Toggle window visibility.
             */
            function toggleWindow() {
                wnd.setVisible(!wnd.isVisible());
                saveSettings();
                if (wnd.isVisible()) {
                    refreshTree();
                    container.focus(); // Focus container when opening window
                }
            }

            // Register window toggle action
            var action = ui.actions.addAction(ACTION_NAME, toggleWindow);
            action.label = menuLabel;
            action.setToggleAction(true);
            action.setSelectedCallback(function() { return wnd.isVisible(); });

            /**
             * Register menu item under Extras or View.
             */
            function registerMenu() {
                var menu = ui.menus.get('extras') || ui.menus.get('view');
                if (menu) {
                    var previousPatch = menu[MENU_PATCH_MARKER];
                    var oldFunct =
                        previousPatch != null && previousPatch.funct != null ?
                            previousPatch.funct :
                            menu.funct;

                    menu[MENU_PATCH_MARKER] = {
                        version: PATCH_VERSION,
                        funct: oldFunct
                    };

                    menu.funct = function(m, parent) {
                        if (typeof oldFunct === 'function') {
                            oldFunct.apply(this, arguments);
                        }

                        ui.menus.addMenuItems(m, ['-', ACTION_NAME], parent);
                    };
                    log('registered in menu successfully.');
                } else {
                    warn('Extras or View menu not found.');
                }
            }

            // Register menu immediately
            if (ui.menus) {
                registerMenu();
            }

            if (!restoreSettings()) {
                wnd.setVisible(false);
            } else {
                refreshTree();
                container.focus();
            }
            
            log('loaded.');

        } catch (e) {
            warn('plugin load error: ' + e);
        }
    });
})();
