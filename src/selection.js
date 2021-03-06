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
