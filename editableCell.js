;(function(e,t,n){function i(n,s){if(!t[n]){if(!e[n]){var o=typeof require=="function"&&require;if(!s&&o)return o(n,!0);if(r)return r(n,!0);throw new Error("Cannot find module '"+n+"'")}var u=t[n]={exports:{}};e[n][0].call(u.exports,function(t){var r=e[n][1][t];return i(r?r:t)},u,u.exports)}return t[n].exports}var r=typeof require=="function"&&require;for(var s=0;s<n.length;s++)i(n[s]);return i})({1:[function(require,module,exports){
var Selection = require('./selection');

// ### `editableCell` binding
//
// The `editableCell` binding turns regular table cells into selectable, editable Excel-like cells.
//
// #### Usage
//
// Bind a property to the table cell element:
//
//     <td data-bind="editableCell: name"></td>
//
// In addition, the following supporting bindings may be used for configuration:
//
// - `cellText` - Overrides the text displayed in the cell
//
//          editableCell: amount, cellText: '$' + amount()
//
// - `cellReadOnly` - Sets whether or not the cell can be edited
//
//          editableCell: amount, cellReadOnly: true
//
// Information on the currently cells in the table can be aquired using the
// [`editableCellSelection`](#editablecellselection) table binding.

// #### Documentation
ko.bindingHandlers.editableCell = {
    // Binding initialization makes sure the common selection is initialized, before initializing the cell in question
    // and registering it with the selection.
    //
    // Every instance of the `editableCell` binding share a per table [selection](#selection).
    // The first cell being initialized per table will do the one-time initialization of the common table selection.
    init: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
        var table = $(element).parents('table')[0],
            selection = table._cellSelection,
            valueBindingName = 'editableCell';

        if (selection === undefined) {
            table._cellSelection = selection = new Selection(table, ko.bindingHandlers.editableCellSelection._selectionMappings);
        }

        selection.registerCell(element);

        if (allBindingsAccessor().cellValue) {
            valueBindingName = 'cellValue';
            valueAccessor = function () { return allBindingsAccessor().cellValue; };
        }

        element._cellTemplated = element.innerHTML.trim() !== '';
        element._cellValue = valueAccessor;
        element._cellText = function () { return allBindingsAccessor().cellText || this._cellValue(); };
        element._cellReadOnly = function () { return ko.utils.unwrapObservable(allBindingsAccessor().cellReadOnly); };
        element._cellValueUpdater = function (newValue) {
            updateBindingValue(valueBindingName, this._cellValue, allBindingsAccessor, newValue);

            if (!ko.isObservable(this._cellValue())) {
                ko.bindingHandlers.editableCell.update(element, valueAccessor, allBindingsAccessor, viewModel, bindingContext);
            }
        };

        ko.utils.domNodeDisposal.addDisposeCallback(element, function () {
            selection.unregisterCell(element);

            element._cellValue = null;
            element._cellText = null;
            element._cellReadOnly = null;
            element._cellValueUpdater = null;
        });

        if (element._cellTemplated) {
            ko.utils.domData.set(element, 'editableCellTemplate', {});
            return { 'controlsDescendantBindings': true };
        }
    },
    // Binding update simply updates the text content of the table cell.
    update: function (element, valueAccessor, allBindingsAccessor, viewModel, bindingContext) {
        if (element._cellTemplated) {
            var template = ko.utils.domData.get(element, 'editableCellTemplate');

            if (!template.savedNodes) {
                template.savedNodes = cloneNodes(ko.virtualElements.childNodes(element), true /* shouldCleanNodes */);
            }
            else {
                ko.virtualElements.setDomNodeChildren(element, cloneNodes(template.savedNodes));
            }

            ko.applyBindingsToDescendants(bindingContext.createChildContext(ko.utils.unwrapObservable(valueAccessor())), element);
        }
        else {
            element.textContent = ko.utils.unwrapObservable(element._cellText());
        }
    }
};

// ### <a name="editablecellselection"></a> `editableCellSelection` binding
//
// The `editableCellSelection` binding is a one-way binding that will reflect the currently selected cells in a table.
//
// #### Usage
//
// 1) Add a `selection` observable array to your view model:
//
//     viewModel.selection = ko.observableArray();
//
// 2) Bind the property to the table element using the `editableCellSelection` binding:
//
//     <table data-bind="editableCellSelection: selection" .. >
//
// Each element in the observable array will have the following properties:
//
// - `cell` - The table cell itself
// - `value` - The value of the `editableCell` binding
// - `text` - The value of the `cellText` binding, or same as `value`
//
// Using utility functions like `ko.dataFor` on the `cell` property, you can get hold of the row view model.

ko.bindingHandlers.editableCellSelection = {
    _selectionMappings: [],

    init: function (element, valueAccessor, allBindingsAccessor) {
        var table = element,
            selection = table._cellSelection;

        if (element.tagName !== 'TABLE') {
            throw new Error('editableCellSelection binding can only be applied to tables');
        }

        if (selection === undefined) {
            table._cellSelection = selection = new Selection(table, ko.bindingHandlers.editableCellSelection._selectionMappings);
        }

        table._cellSelectionSubscriptions = table._cellSelectionSubscriptions || [];

        // Update supplied observable array when selection range changes
        table._cellSelectionSubscriptions.push(selection.range.selection.subscribe(function (newSelection) {
            newSelection = ko.utils.arrayMap(newSelection, function (cell) {
                return {
                    cell: cell,
                    value: cell._cellValue(),
                    text: cell._cellText()
                };
            });

            updateBindingValue('editableCellSelection', valueAccessor, allBindingsAccessor, newSelection);
        }));

        // Keep track of selections
        ko.bindingHandlers.editableCellSelection._selectionMappings.push([valueAccessor, table]);

        // Perform clean-up when table is removed from DOM
        ko.utils.domNodeDisposal.addDisposeCallback(table, function () {
            // Detach selection from table
            table._cellSelection = null;

            // Remove selection from list
            var selectionIndex = ko.utils.arrayFirst(ko.bindingHandlers.editableCellSelection._selectionMappings, function (tuple) {
                return tuple[0] === valueAccessor;
            });
            ko.bindingHandlers.editableCellSelection._selectionMappings.splice(selectionIndex, 1);

            // Dispose subscriptions
            disposeSelectionSubscriptions(table);
        });
    },
    update: function (element, valueAccessor, allBindingsAccessor) {
        var table = element,
            selection = table._cellSelection,
            newSelection = ko.utils.unwrapObservable(valueAccessor()) || [];

        // Empty selection, so simply clear it out
        if (newSelection.length === 0) {
            selection.range.clear();
            return;
        }

        var start = newSelection[0],
            end = newSelection[newSelection.length - 1];

        var isDirectUpdate = start.tagName === 'TD' || start.tagName === 'TH';

        // Notification of changed selection, either after programmatic  
        // update or after changing current selection in user interface
        if (!isDirectUpdate) {
            start = start.cell;
            end = end.cell;
        }

        // Make sure selected cells belongs to current table, or else hide selection
        var parentRowHidden = !start.parentNode;
        var belongingToOtherTable = start.parentNode && start.parentNode.parentNode.parentNode !== table;

        if (parentRowHidden || belongingToOtherTable) {
            // Selection cannot be cleared, since that will affect selection in other table
            selection.view.hide();
            return;
        }

        // Programmatic update of selection, i.e. selection([startCell, endCell]);
        if (isDirectUpdate) {
            selection.range.setStart(start);
            selection.range.setEnd(end);
        }
    }
};

ko.bindingHandlers.editableCellViewport = {
    init: function (element) {
        var table = element,
            selection = table._cellSelection;

        if (element.tagName !== 'TABLE') {
            throw new Error('editableCellSelection binding can only be applied to tables');
        }

        if (selection === undefined) {
            table._cellSelection = selection = new Selection(table, ko.bindingHandlers.editableCellSelection._selectionMappings);
        }
    },
    update: function (element, valueAccessor) {
        var table = element,
            selection = table._cellSelection,
            viewport = ko.utils.unwrapObservable(valueAccessor());

        selection.setViewport(viewport);
    }
};

function disposeSelectionSubscriptions (element) {
    ko.utils.arrayForEach(element._cellSelectionSubscriptions, function (subscription) {
        subscription.dispose();
    });
    element._cellSelectionSubscriptions = null;
}

// `updateBindingValue` is a helper function borrowing private binding update functionality
// from Knockout.js for supporting updating of both observables and non-observables.
function updateBindingValue (bindingName, valueAccessor, allBindingsAccessor, newValue) {
    if (ko.isWriteableObservable(valueAccessor())) {
        valueAccessor()(newValue);
        return;
    }

    var propertyWriters = allBindingsAccessor()._ko_property_writers;
    if (propertyWriters && propertyWriters[bindingName]) {
        propertyWriters[bindingName](newValue);
    }

    if (!ko.isObservable(valueAccessor())) {
        allBindingsAccessor()[bindingName] = newValue;
    }
}

// Borrowed from Knockout.js
function cloneNodes (nodesArray, shouldCleanNodes) {
    for (var i = 0, j = nodesArray.length, newNodesArray = []; i < j; i++) {
        var clonedNode = nodesArray[i].cloneNode(true);
        newNodesArray.push(shouldCleanNodes ? ko.cleanNode(clonedNode) : clonedNode);
    }
    return newNodesArray;
}
},{"./selection":2}],2:[function(require,module,exports){
var SelectionView = require('./selectionView'),
    SelectionRange = require('./selectionRange');

module.exports = Selection;

// #### <a name="selection"></a> `Selection`
//
// The `Selection` is used internally to represent the selection for a single table,
// comprising a [view](#view) and a [range](#range), as well as functionality for handling table cell
// operations like selecting, editing and copy and paste.
function Selection (table, selectionMappings) {
    var self = this,
        selectionSubscription;

    self.view = new SelectionView(table, self);
    self.range = new SelectionRange(getRowByIndex, getCellByIndex, cellIsSelectable, cellIsVisible);

    selectionSubscription = self.range.selection.subscribe(function (newSelection) {
        if (newSelection.length === 0) {
            self.view.hide();
            return;
        }
        self.view.update(newSelection[0], newSelection[newSelection.length - 1]);
    });

    ko.utils.domNodeDisposal.addDisposeCallback(table, function () {
        selectionSubscription.dispose();

        self.view.destroy();
        self.range.clear();

        table._cellSelection = null;
    });

    self.focus = self.view.focus;

    self.setViewport = function (viewport) {
        self.view.viewport = viewport;
    };

    self.registerCell = function (cell) {
        ko.utils.registerEventHandler(cell, "mousedown", self.onMouseDown);
        ko.utils.registerEventHandler(cell, "mouseover", self.onCellMouseOver);
        ko.utils.registerEventHandler(cell, "focus", self.onCellFocus);
    };

    self.unregisterCell = function (cell) {
        cell.removeEventListener('mousedown', self.onMouseDown);
        cell.removeEventListener('mouseover', self.onCellMouseOver);
        cell.removeEventListener('focus', self.onCellFocus);
    };

    self.onMouseDown = function (event) {
        if (self.isEditingCell()) {
            return;
        }

        self.onCellMouseDown(this, event.shiftKey);
        event.preventDefault();
    };

    self.updateCellValue = function (cell, newValue) {
        var value;

        if (!cellIsEditable(cell)) {
            return undefined;
        }

        if (newValue === undefined) {
            value = self.view.inputElement.value;
        }
        else {
            value = newValue;
        }

        cell._cellValueUpdater(value);

        return value;
    };

    self.startEditing = function () {
        self.startEditingCell(self.range.start);
    };

    self.startLockedEditing = function () {
        self.startEditingCell(self.range.start, true);
    };

    self.startEditingCell = function (cell, isLockedToCell) {
        if (!cellIsEditable(cell)) {
            return;
        }

        if (self.range.start !== cell) {
            self.range.setStart(cell);
        }

        self.view.inputElement.style.top = table.offsetTop + cell.offsetTop + 'px';
        self.view.inputElement.style.left = table.offsetLeft + cell.offsetLeft + 'px';
        self.view.inputElement.style.width = cell.offsetWidth + 'px';
        self.view.inputElement.style.height = cell.offsetHeight + 'px';
        self.view.inputElement.value = ko.utils.unwrapObservable(cell._cellValue());
        self.view.inputElement.style.display = 'block';
        self.view.inputElement.focus();
        self.view.isLockedToCell = isLockedToCell;

        document.execCommand('selectAll', false, null);
        self.view.element.style.pointerEvents = 'none';
    };
    self.isEditingCell = function (cell) {
        return self.view.inputElement.style.display === 'block';
    };
    self.cancelEditingCell = function (cell) {
        self.view.inputElement.style.display = 'none';
        self.view.element.style.pointerEvents = 'inherit';
    };
    self.endEditingCell = function (cell) {
        self.view.inputElement.style.display = 'none';
        self.view.element.style.pointerEvents = 'inherit';
        return self.updateCellValue(cell);
    };
    function cellIsSelectable(cell) {
        return cell._cellValue !== undefined;
    }
    function cellIsEditable(cell) {
        return cell._cellReadOnly() !== true;
    }
    function cellIsVisible (cell) {
        return cell && cell.offsetHeight !== 0;
    }
    function getRowByIndex (index, originTable) {
        var targetTable = originTable || table;

        // Check if we're moving out of table
        if (index === -1 || index === targetTable.rows.length) {
            // Find selection mapping for table
            var selectionMapping = getSelectionMappingForTable(targetTable);

            // We can only proceed check if mapping exists, i.e. that editableCellSelection binding is used
            if (selectionMapping) {
                // Find all selection mappings for selection, excluding the one for the current table
                var tableMappings = ko.utils.arrayFilter(selectionMappings, function (tuple) {
                    return tuple[0]() === selectionMapping[0]() && tuple[1] !== targetTable;
                });

                var tables = ko.utils.arrayMap(tableMappings, function (tuple) { return tuple[1]; });
                var beforeTables = ko.utils.arrayFilter(tables, function (t) { return t.offsetTop + t.offsetHeight <= table.offsetTop; });
                var afterTables = ko.utils.arrayFilter(tables, function (t) { return t.offsetTop >= table.offsetTop + table.offsetHeight; });

                // Moving upwards
                if (index === -1 && beforeTables.length) {
                    targetTable = beforeTables[beforeTables.length - 1];
                    index = targetTable.rows.length - 1;
                }
                // Moving downwards
                else if (index === targetTable.rows.length && afterTables.length) {
                    targetTable = afterTables[0];
                    index = 0;
                }
            }
        }
        
        return targetTable.rows[index];
    }
    function getCellByIndex (row, index) {
        var i, colSpanSum = 0;

        for (i = 0; i < row.children.length; i++) {
            if (index < colSpanSum) {
                return row.children[i - 1];
            }
            if (index === colSpanSum) {
                return row.children[i];
            }

            colSpanSum += row.children[i].colSpan;
        }
    }
    function getSelectionMappingForTable (table) {
        return ko.utils.arrayFirst(selectionMappings, function (tuple) {
                return tuple[1] === table;
        });
    }
    self.onCellMouseDown = function (cell, shiftKey) {
        if (shiftKey) {
            self.range.setEnd(cell);
        }
        else {
            self.range.setStart(cell);
        }

        self.view.beginDrag();
        event.preventDefault();
    };
    self.onCellMouseOver = function (event) {
        var cell = event.target;

        if (!self.view.isDragging) {
            return;
        }

        while (cell && !(cell.tagName === 'TD' || cell.tagName === 'TH')) {
            cell = cell.parentNode;
        }

        if (cell && cell !== self.range.end) {
            self.range.setEnd(cell);
        }
    };
    self.onCellFocus = function (event) {
        if (event.target === self.range.start) {
            return;
        }

        setTimeout(function () {
            self.range.setStart(event.target);
        }, 0);
    };
    self.onReturn = function (event, preventMove) {
        if (preventMove !== true) {
            self.range.moveInDirection('Down');
        }
        event.preventDefault();
    };
    self.onArrows = function (event) {
        var newStartOrEnd, newTable;

        if (event.shiftKey && !event.ctrlKey) {
            newStartOrEnd = self.range.extendInDirection(self.keyCodeIdentifier[event.keyCode]);
        }
        else if (!event.ctrlKey) {
            newStartOrEnd = self.range.moveInDirection(self.keyCodeIdentifier[event.keyCode]);
            newTable = newStartOrEnd && newStartOrEnd.parentNode && newStartOrEnd.parentNode.parentNode.parentNode;

            if (newTable !== table) {
                var mapping = getSelectionMappingForTable(newTable);
                if (mapping) {
                    var selection = mapping[0]();
                    selection([newStartOrEnd]);
                }
            }
        }

        if (newStartOrEnd) {
            event.preventDefault();
        }
    };
    self.onCopy = function () {
        var cells = self.range.getCells(),
            cols = cells[cells.length - 1].cellIndex - cells[0].cellIndex + 1,
            rows = cells.length / cols,
            lines = [],
            i = 0;

        ko.utils.arrayForEach(cells, function (cell) {
            var lineIndex = i % rows,
                rowIndex = Math.floor(i / rows);

            lines[lineIndex] = lines[lineIndex] || [];
            lines[lineIndex][rowIndex] = ko.utils.unwrapObservable(cell._cellValue());

            i++;
        });

        return ko.utils.arrayMap(lines, function (line) {
            return line.join('\t');
        }).join('\r\n');
    };
    self.onPaste = function (text) {
        var selStart = self.range.getCells()[0],
            cells,
            values = ko.utils.arrayMap(text.trim().split(/\r?\n/), function (line) { return line.split('\t'); }),
            row = values.length,
            col = values[0].length,
            rows = 1,
            cols = 1,
            i = 0;

        self.range.setStart(selStart);

        while (row-- > 1 && self.range.extendInDirection('Down')) { rows++; }
        while (col-- > 1 && self.range.extendInDirection('Right')) { cols++; }

        cells = self.range.getCells();

        for (col = 0; col < cols; col++) {
            for (row = 0; row < rows; row++) {
                self.updateCellValue(cells[i], values[row][col]);
                i++;
            }
        }
    };
    self.onTab = function (event) {
        self.range.start.focus();
    };
    self.keyCodeIdentifier = {
        37: 'Left',
        38: 'Up',
        39: 'Right',
        40: 'Down'
    };
}

},{"./selectionView":3,"./selectionRange":4}],3:[function(require,module,exports){
module.exports = SelectionView;

// #### <a name="view"></a> `SelectionView`
//
// The `SelectionView` is used internally to represent the selection view, that is the
// visual selection of either one or more cells.
function SelectionView (table, selection) {
    var self = this,
        html = document.getElementsByTagName('html')[0];

    self.viewport = {};

    self.element = document.createElement('div');
    self.element.className = 'editable-cell-selection';
    self.element.style.position = 'absolute';
    self.element.style.display = 'none';
    self.element.tabIndex = -1;

    self.inputElement = document.createElement('input');
    self.inputElement.className = 'editable-cell-input';
    self.inputElement.style.position = 'absolute';
    self.inputElement.style.display = 'none';

    self.copyPasteElement = document.createElement('textarea');
    self.copyPasteElement.style.position = 'absolute';
    self.copyPasteElement.style.opacity = '0.0';
    self.copyPasteElement.style.display = 'none';

    table.parentNode.insertBefore(self.element, table.nextSibling);
    table.parentNode.insertBefore(self.inputElement, table.nextSibling);
    table.appendChild(self.copyPasteElement);

    self.destroy = function () {
        self.element.removeEventListener('mousedown', self.onMouseDown);
        self.element.removeEventListener('dblclick', self.onDblClick);
        self.element.removeEventListener('keypress', self.onKeyPress);
        self.element.removeEventListener('keydown', self.onKeyDown);

        self.inputElement.removeEventListener('keydown', self.onInputKeydown);
        self.inputElement.removeEventListener('blur', self.onInputBlur);

        $(html).unbind('mouseup', self.onMouseUp);

        table.parentNode.removeChild(self.element);
        table.parentNode.removeChild(self.inputElement);
        table.removeChild(self.copyPasteElement);
    };
    self.show = function () {
        self.element.style.display = 'block';
        self.element.focus();

        var margin = 10,
            viewportTop = resolve(self.viewport.top) || 0,
            viewportBottom = resolve(self.viewport.bottom) || window.innerHeight,
            rect = selection.range.end.getBoundingClientRect(),
            topOffset = rect.top - margin - viewportTop,
            bottomOffset = viewportBottom - rect.bottom - margin;

        if (topOffset < 0) {
            document.documentElement.scrollTop += topOffset;
        }
        else if (bottomOffset < 0) {
            document.documentElement.scrollTop -= bottomOffset;
        }
    };
    
    function resolve (value) {
        if (typeof value === 'function') {
            return value();
        }

        return value;
    }

    self.hide = function () {
        self.element.style.display = 'none';
    };
    self.focus = function () {
        self.element.focus();
    };
    self.update = function (start, end) {
        var top = Math.min(start.offsetTop, end.offsetTop),
            left = Math.min(start.offsetLeft, end.offsetLeft),
            bottom = Math.max(start.offsetTop + start.offsetHeight,
                            end.offsetTop + end.offsetHeight),
            right = Math.max(start.offsetLeft + start.offsetWidth,
                            end.offsetLeft + end.offsetWidth);

        self.element.style.top = table.offsetTop + top + 1 + 'px';
        self.element.style.left = table.offsetLeft + left + 1 + 'px';
        self.element.style.height = bottom - top - 1 + 'px';
        self.element.style.width = right - left - 1 + 'px';
        self.element.style.backgroundColor = 'rgba(245, 142, 00, 0.15)';

        self.show();
    };
    self.beginDrag = function () {
        self.canDrag = true;
        ko.utils.registerEventHandler(self.element, 'mousemove', self.doBeginDrag);
    };
    self.doBeginDrag = function () {
        self.element.removeEventListener('mousemove', self.doBeginDrag);

        if (!self.canDrag) {
            return;
        }

        self.isDragging = true;
        self.element.style.pointerEvents = 'none';
    };
    self.endDrag = function () {
        self.element.removeEventListener('mousemove', self.doBeginDrag);
        self.isDragging = false;
        self.canDrag = false;
        self.element.style.pointerEvents = 'inherit';
    };

    self.onMouseUp = function (event) {
        self.endDrag();
    };
    self.onMouseDown = function (event) {
        if (event.button !== 0) {
            return;
        }

        self.hide();

        var cell = event.view.document.elementFromPoint(event.clientX, event.clientY);
        selection.onCellMouseDown(cell, event.shiftKey);

        event.preventDefault();
    };
    self.onDblClick = function (event) {
        selection.startLockedEditing();
    };
    self.onKeyPress = function (event) {
        selection.startEditing();
    };
    self.onKeyDown = function (event) {
        if (event.keyCode === 13) {
            selection.onReturn(event);
        } else if ([37, 38, 39, 40].indexOf(event.keyCode) !== -1) {
            selection.onArrows(event);
        } else if (event.keyCode === 86 && event.ctrlKey) {
            self.copyPasteElement.value = '';
            self.copyPasteElement.style.display = 'block';
            self.copyPasteElement.focus();
            setTimeout(function () {
                selection.onPaste(self.copyPasteElement.value);
                self.copyPasteElement.style.display = 'none';
                self.focus();
            }, 0);
        } else if (event.keyCode === 67 && event.ctrlKey) {
            self.copyPasteElement.value = selection.onCopy();
            self.copyPasteElement.style.display = 'block';
            self.copyPasteElement.focus();
            document.execCommand('selectAll', false, null);
            setTimeout(function () {
                self.copyPasteElement.style.display = 'none';
                self.focus();
            }, 0);
        } else if (event.keyCode === 9) {
            selection.onTab(event);
        }
    };
    self.onInputKeydown = function (event) {
        var cell = selection.range.start;

        if (event.keyCode === 13) { // Return
            var value = selection.endEditingCell(cell);

            if (event.ctrlKey) {
                ko.utils.arrayForEach(selection.range.getCells(), function (cellInSelection) {
                if (cellInSelection !== cell) {
                    selection.updateCellValue(cellInSelection, value);
                }
                });
          }

            selection.onReturn(event, event.ctrlKey);
            self.focus();
            event.preventDefault();
        }
        else if (event.keyCode === 27) { // Escape
            selection.cancelEditingCell(cell);
            self.focus();
        }
        else if ([37, 38, 39, 40].indexOf(event.keyCode) !== -1) { // Arrows
            if(!self.isLockedToCell) {
                self.focus();
                selection.onArrows(event);
                event.preventDefault();
            }
        }
    };
    self.onInputBlur = function (event) {
        if (!selection.isEditingCell()) {
            return;
        }
        selection.endEditingCell(selection.range.start);
    };

    ko.utils.registerEventHandler(self.element, "mousedown", self.onMouseDown);
    ko.utils.registerEventHandler(self.element, "dblclick", self.onDblClick);
    ko.utils.registerEventHandler(self.element, "keypress", self.onKeyPress);
    ko.utils.registerEventHandler(self.element, "keydown", self.onKeyDown);

    ko.utils.registerEventHandler(self.inputElement, "keydown", self.onInputKeydown);
    ko.utils.registerEventHandler(self.inputElement, "blur", self.onInputBlur);

    ko.utils.registerEventHandler(html, "mouseup", self.onMouseUp);
}

},{}],4:[function(require,module,exports){
module.exports = SelectionRange;

// #### <a name="range"></a> `SelectionRange`
//
// The `SelectionRange` is used internally to hold the current selection, represented by a start and an end cell.
// In addition, it has functionality for moving and extending the selection inside the table.
function SelectionRange (getRowByIndex, getCellByIndex, cellIsSelectable, cellIsVisible) {
    var self = this;

    self.start = undefined;
    self.end = undefined;
    self.selection = ko.observableArray();

    // `moveInDirection` drops the current selection and makes the single cell in the specified `direction` the new selection.
    self.moveInDirection = function (direction) {
        var newStart = self.getSelectableCellInDirection(self.start, direction),
            startChanged = newStart !== self.start,
            belongingToOtherTable = newStart.parentNode.parentNode.parentNode !== self.start.parentNode.parentNode.parentNode;

        if (!belongingToOtherTable && (startChanged || self.start !== self.end)) {
            self.setStart(newStart);
        }

        if (startChanged) {
            return newStart;
        }
    };

    // `extendIndirection` keeps the current selection and extends it in the specified `direction`.
    self.extendInDirection = function (direction) {
        var newEnd = self.getCellInDirection(self.end, direction),
            endChanged = newEnd && newEnd !== self.end;

        if (newEnd) {
            self.setEnd(newEnd);    
        }

        if (endChanged) {
            return newEnd;
        }
    };

    // `getCells` returnes the cells contained in the current selection.
    self.getCells = function () {
        return self.getCellsInArea(self.start, self.end);
    };

    // `clear` clears the current selection.
    self.clear = function () {
        self.start = undefined;
        self.end = undefined;
        self.selection([]);
    };

    self.setStart = function (element) {
        self.start = element;
        self.end = element;
        self.selection(self.getCells());
    };
    self.setEnd = function (element) {
        if (element === self.end) {
            return;
        }
        self.start = self.start || element;

        var cellsInArea = self.getCellsInArea(self.start, element),
            allEditable = true;

        ko.utils.arrayForEach(cellsInArea, function (cell) {
            allEditable = allEditable && cellIsSelectable(cell);
        });

        if (!allEditable) {
            return;
        }

        self.end = element;
        self.selection(self.getCells());
    };
    self.getCellInDirection = function (originCell, direction) {

        var rowIndex = originCell.parentNode.rowIndex;
        var cellIndex = getCellIndex(originCell);

        var table = originCell.parentNode.parentNode.parentNode,
            row = getRowByIndex(rowIndex + getDirectionYDelta(direction), table),
            cell = row && getCellByIndex(row, cellIndex + getDirectionXDelta(direction, originCell));

        if (direction === 'Left' && cell) {
            return cellIsVisible(cell) && cell || self.getCellInDirection(cell, direction);
        }
        if (direction === 'Up' && row && cell) {
            return cellIsVisible(cell) && cell || self.getCellInDirection(cell, direction);
        }
        if (direction === 'Right' && cell) {
            return cellIsVisible(cell) && cell || self.getCellInDirection(cell, direction);
        }
        if (direction === 'Down' && row && cell) {
            return cellIsVisible(cell) && cell || self.getCellInDirection(cell, direction);
        }

        return undefined;
    };
    self.getSelectableCellInDirection = function (originCell, direction) {
        var lastCell,
            cell = originCell;

        while (cell) {
            cell = self.getCellInDirection(cell, direction);

            if (cell && cellIsSelectable(cell)) {
                return cell;
            }
        }

        return originCell;
    };
    self.getCellsInArea = function (startCell, endCell) {
        var startX = Math.min(getCellIndex(startCell), getCellIndex(endCell)),
            startY = Math.min(startCell.parentNode.rowIndex, endCell.parentNode.rowIndex),
            endX = Math.max(getCellIndex(startCell), getCellIndex(endCell)),
            endY = Math.max(startCell.parentNode.rowIndex, endCell.parentNode.rowIndex),
            x, y,
            cell,
            cells = [];

        for (x = startX; x <= endX; ++x) {
            for (y = startY; y <= endY; ++y) {
                cell = getCellByIndex(getRowByIndex(y), x);
                cells.push(cell || {});
            }
        }

        return cells;
    };
    
    function getDirectionXDelta (direction, cell) {
        if (direction === 'Left') {
            return -1;
        }

        if (direction === 'Right') {
            return cell.colSpan;
        }

        return 0;
    }

    function getDirectionYDelta (direction) {
        if (direction === 'Up') {
            return -1;
        }

        if (direction === 'Down') {
            return 1;
        }

        return 0;
    }

    function getCellIndex (cell) {
        var row = cell.parentNode,
            colSpanSum = 0,
            i;

        for (i = 0; i < row.children.length; i++) {
            if (row.children[i] === cell) {
                break;
            }

            colSpanSum += row.children[i].colSpan;
        }

        return colSpanSum;
    }
}
},{}]},{},[1])
;