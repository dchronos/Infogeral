(function ($) {

/**
 * Drag and drop table rows with field manipulation.
 *
 * Using the drupal_add_tabledrag() function, any table with weights or parent
 * relationships may be made into draggable tables. Columns containing a field
 * may optionally be hidden, providing a better user experience.
 *
 * Created tableDrag instances may be modified with custom behaviors by
 * overriding the .onDrag, .onDrop, .row.onSwap, and .row.onIndent methods.
 * See blocks.js for an example of adding additional functionality to tableDrag.
 */
Drupal.behaviors.tableDrag = {
  attach: function (context, settings) {
    for (var base in settings.tableDrag) {
      $('#' + base, context).once('tabledrag', function () {
        // Create the new tableDrag instance. Save in the Drupal variable
        // to allow other scripts access to the object.
        Drupal.tableDrag[base] = new Drupal.tableDrag(this, settings.tableDrag[base]);
      });
    }
  }
};

/**
 * Constructor for the tableDrag object. Provides table and field manipulation.
 *
 * @param table
 *   DOM object for the table to be made draggable.
 * @param tableSettings
 *   Settings for the table added via drupal_add_dragtable().
 */
Drupal.tableDrag = function (table, tableSettings) {
  var self = this;

  // Required object variables.
  this.table = table;
  this.tableSettings = tableSettings;
  this.dragObject = null; // Used to hold information about a current drag operation.
  this.rowObject = null; // Provides operations for row manipulation.
  this.oldRowElement = null; // Remember the previous element.
  this.oldY = 0; // Used to determine up or down direction from last mouse move.
  this.changed = false; // Whether anything in the entire table has changed.
  this.maxDepth = 0; // Maximum amount of allowed parenting.
  this.rtl = $(this.table).css('direction') == 'rtl' ? -1 : 1; // Direction of the table.

  // Configure the scroll settings.
  this.scrollSettings = { amount: 4, interval: 50, trigger: 70 };
  this.scrollInterval = null;
  this.scrollY = 0;
  this.windowHeight = 0;

  // Check this table's settings to see if there are parent relationships in
  // this table. For efficiency, large sections of code can be skipped if we
  // don't need to track horizontal movement and indentations.
  this.indentEnabled = false;
  for (var group in tableSettings) {
    for (var n in tableSettings[group]) {
      if (tableSettings[group][n].relationship == 'parent') {
        this.indentEnabled = true;
      }
      if (tableSettings[group][n].limit > 0) {
        this.maxDepth = tableSettings[group][n].limit;
      }
    }
  }
  if (this.indentEnabled) {
    this.indentCount = 1; // Total width of indents, set in makeDraggable.
    // Find the width of indentations to measure mouse movements against.
    // Because the table doesn't need to start with any indentations, we
    // manually append 2 indentations in the first draggable row, measure
    // the offset, then remove.
    var indent = Drupal.theme('tableDragIndentation');
    var testRow = $('<tr/>').addClass('draggable').appendTo(table);
    var testCell = $('<td/>').appendTo(testRow).prepend(indent).prepend(indent);
    this.indentAmount = $('.indentation', testCell).get(1).offsetLeft - $('.indentation', testCell).get(0).offsetLeft;
    testRow.remove();
  }

  // Make each applicable row draggable.
  // Match immediate children of the parent element to allow nesting.
  $('> tr.draggable, > tbody > tr.draggable', table).each(function () { self.makeDraggable(this); });

  // Add a link before the table for users to show or hide weight columns.
  $(table).before($('<a href="#" class="tabledrag-toggle-weight"></a>')
    .attr('title', Drupal.t('Re-order rows by numerical weight instead of dragging.'))
    .click(function () {
      if ($.cookie('Drupal.tableDrag.showWeight') == 1) {
        self.hideColumns();
      }
      else {
        self.showColumns();
      }
      return false;
    })
    .wrap('<div class="tabledrag-toggle-weight-wrapper"></div>')
    .parent()
  );

  // Initialize the specified columns (for example, weight or parent columns)
  // to show or hide according to user preference. This aids accessibility
  // so that, e.g., screen reader users can choose to enter weight values and
  // manipulate form elements directly, rather than using drag-and-drop..
  self.initColumns();

  // Add mouse bindings to the document. The self variable is passed along
  // as event handlers do not have direct access to the tableDrag object.
  $(document).bind('mousemove', function (event) { return self.dragRow(event, self); });
  $(document).bind('mouseup', function (event) { return self.dropRow(event, self); });
};

/**
 * Initialize columns containing form elements to be hidden by default,
 * according to the settings for this tableDrag instance.
 *
 * Identify and mark each cell with a CSS class so we can easily toggle
 * show/hide it. Finally, hide columns if user does not have a
 * 'Drupal.tableDrag.showWeight' cookie.
 */
Drupal.tableDrag.prototype.initColumns = function () {
  for (var group in this.tableSettings) {
    // Find the first field in this group.
    for (var d in this.tableSettings[group]) {
      var field = $('.' + this.tableSettings[group][d].target + ':first', this.table);
      if (field.size() && this.tableSettings[group][d].hidden) {
        var hidden = this.tableSettings[group][d].hidden;
        var cell = field.parents('td:first');
        break;
      }
    }

    // Mark the column containing this field so it can be hidden.
    if (hidden && cell[0] && cell.css('display') != 'none') {
      // Add 1 to our indexes. The nth-child selector is 1 based, not 0 based.
      // Match immediate children of the parent element to allow nesting.
      var columnIndex = $('> td', cell.parent()).index(cell.get(0)) + 1;
      var headerIndex = $('> td:not(:hidden)', cell.parent()).index(cell.get(0)) + 1;
      $('> thead > tr, > tbody > tr, > tr', this.table).each(function (){
        var row = $(this);
        var parentTag = row.parent().get(0).tagName.toLowerCase();
        var index = (parentTag == 'thead') ? headerIndex : columnIndex;

        // Adjust the index to take into account colspans.
        row.children().each(function (n) {
          if (n < index) {
            index -= (this.colSpan && this.colSpan > 1) ? this.colSpan - 1 : 0;
          }
        });
        if (index > 0) {
          cell = row.children(':nth-child(' + index + ')');
          if (cell[0].colSpan > 1) {
            // If this cell has a colspan, mark it so we can reduce the colspan.
            $(cell[0]).addClass('tabledrag-has-colspan');
          }
          else {
            // Mark this cell so we can hide it.
            $(cell[0]).addClass('tabledrag-hide');
          }
        }
      });
    }
  }

  // Now hide cells and reduce colspans unless cookie indicates previous choice.
  // Set a cookie if it is not already present.
  if ($.cookie('Drupal.tableDrag.showWeight') === null) {
    $.cookie('Drupal.tableDrag.showWeight', 0, {
      path: Drupal.settings.basePath,
      // The cookie expires in one year.
      expires: 365
    });
    this.hideColumns();
  }
  // Check cookie value and show/hide weight columns accordingly.
  else {
    if ($.cookie('Drupal.tableDrag.showWeight') == 1) {
      this.showColumns();
    }
    else {
      this.hideColumns();
    }
  }
};

/**
 * Hide the columns containing weight/parent form elements.
 * Undo showColumns().
 */
Drupal.tableDrag.prototype.hideColumns = function () {
  // Hide weight/parent cells and headers.
  $('.tabledrag-hide', 'table.tabledrag-processed').css('display', 'none');
  // Show TableDrag handles.
  $('.tabledrag-handle', 'table.tabledrag-processed').css('display', '');
  // Reduce the colspan of any effected multi-span columns.
  $('.tabledrag-has-colspan', 'table.tabledrag-processed').each(function () {
    this.colSpan = this.colSpan - 1;
  });
  // Change link text.
  $('.tabledrag-toggle-weight').text(Drupal.t('Show row weights'));
  // Change cookie.
  $.cookie('Drupal.tableDrag.showWeight', 0, {
    path: Drupal.settings.basePath,
    // The cookie expires in one year.
    expires: 365
  });
};

/**
 * Show the columns containing weight/parent form elements
 * Undo hideColumns().
 */
Drupal.tableDrag.prototype.showColumns = function () {
  // Show weight/parent cells and headers.
  $('.tabledrag-hide', 'table.tabledrag-processed').css('display', '');
  // Hide TableDrag handles.
  $('.tabledrag-handle', 'table.tabledrag-processed').css('display', 'none');
  // Increase the colspan for any columns where it was previously reduced.
  $('.tabledrag-has-colspan', 'table.tabledrag-processed').each(function () {
    this.colSpan = this.colSpan + 1;
  });
  // Change link text.
  $('.tabledrag-toggle-weight').text(Drupal.t('Hide row weights'));
  // Change cookie.
  $.cookie('Drupal.tableDrag.showWeight', 1, {
    path: Drupal.settings.basePath,
    // The cookie expires in one year.
    expires: 365
  });
};

/**
 * Find the target used within a particular row and group.
 */
Drupal.tableDrag.prototype.rowSettings = function (group, row) {
  var field = $('.' + group, row);
  for (var delta in this.tableSettings[group]) {
    var targetClass = this.tableSettings[group][delta].target;
    if (field.is('.' + targetClass)) {
      // Return a copy of the row settings.
      var rowSettings = {};
      for (var n in this.tableSettings[group][delta]) {
        rowSettings[n] = this.tableSettings[group][delta][n];
      }
      return rowSettings;
    }
  }
};

/**
 * Take an item and add event handlers to make it become draggable.
 */
Drupal.tableDrag.prototype.makeDraggable = function (item) {
  var self = this;

  // Create the handle.
  var handle = $('<a href="#" class="tabledrag-handle"><div class="handle">&nbsp;</div></a>').attr('title', Drupal.t('Drag to re-order'));
  // Insert the handle after indentations (if any).
  if ($('td:first .indentation:last', item).length) {
    $('td:first .indentation:last', item).after(handle);
    // Update the total width of indentation in this entire table.
    self.indentCount = Math.max($('.indentation', item).size(), self.indentCount);
  }
  else {
    $('td:first', item).prepend(handle);
  }

  // Add hover action for the handle.
  handle.hover(function () {
    self.dragObject == null ? $(this).addClass('tabledrag-handle-hover') : null;
  }, function () {
    self.dragObject == null ? $(this).removeClass('tabledrag-handle-hover') : null;
  });

  // Add the mousedown action for the handle.
  handle.mousedown(function (event) {
    // Create a new dragObject recording the event information.
    self.dragObject = {};
    self.dragObject.initMouseOffset = self.getMouseOffset(item, event);
    self.dragObject.initMouseCoords = self.mouseCoords(event);
    if (self.indentEnabled) {
      self.dragObject.indentMousePos = self.dragObject.initMouseCoords;
    }

    // If there's a lingering row object from the keyboard, remove its focus.
    if (self.rowObject) {
      $('a.tabledrag-handle', self.rowObject.element).blur();
    }

    // Create a new rowObject for manipulation of this row.
    self.rowObject = new self.row(item, 'mouse', self.indentEnabled, self.maxDepth, true);

    // Save the position of the table.
    self.table.topY = $(self.table).offset().top;
    self.table.bottomY = self.table.topY + self.table.offsetHeight;

    // Add classes to the handle and row.
    $(this).addClass('tabledrag-handle-hover');
    $(item).addClass('drag');

    // Set the document to use the move cursor during drag.
    $('body').addClass('drag');
    if (self.oldRowElement) {
      $(self.oldRowElement).removeClass('drag-previous');
    }

    // Hack for IE6 that flickers uncontrollably if select lists are moved.
    if (navigator.userAgent.indexOf('MSIE 6.') != -1) {
      $('select', this.table).css('display', 'none');
    }

    // Hack for Konqueror, prevent the blur handler from firing.
    // Konqueror always gives links focus, even after returning false on mousedown.
    self.safeBlur = false;

    // Call optional placeholder function.
    self.onDrag();
    return false;
  });

  // Prevent the anchor tag from jumping us to the top of the page.
  handle.click(function () {
    return false;
  });

  // Similar to the hover event, add a class when the handle is focused.
  handle.focus(function () {
    $(this).addClass('tabledrag-handle-hover');
    self.safeBlur = true;
  });

  // Remove the handle class on blur and fire the same function as a mouseup.
  handle.blur(function (event) {
    $(this).removeClass('tabledrag-handle-hover');
    if (self.rowObject && self.safeBlur) {
      self.dropRow(event, self);
    }
  });

  // Add arrow-key support to the handle.
  handle.keydown(function (event) {
    // If a rowObject doesn't yet exist and this isn't the tab key.
    if (event.keyCode != 9 && !self.rowObject) {
      self.rowObject = new self.row(item, 'keyboard', self.indentEnabled, self.maxDepth, true);
    }

    var keyChange = false;
    switch (event.keyCode) {
      case 37: // Left arrow.
      case 63234: // Safari left arrow.
        keyChange = true;
        self.rowObject.indent(-1 * self.rtl);
        break;
      case 38: // Up arrow.
      case 63232: // Safari up arrow.
        var previousRow = $(self.rowObject.element).prev('tr').get(0);
        while (previousRow && $(previousRow).is(':hidden')) {
          previousRow = $(previousRow).prev('tr').get(0);
        }
        if (previousRow) {
          self.safeBlur = false; // Do not allow the onBlur cleanup.
          self.rowObject.direction = 'up';
          keyChange = true;

          if ($(item).is('.tabledrag-root')) {
            // Swap with the previous top-level row.
            var groupHeight = 0;
            while (previousRow && $('.indentation', previousRow).size()) {
              previousRow = $(previousRow).prev('tr').get(0);
              groupHeight += $(previousRow).is(':hidden') ? 0 : previousRow.offsetHeight;
            }
            if (previousRow) {
              self.rowObject.swap('before', previousRow);
              // No need to check for indentation, 0 is the only valid one.
              window.scrollBy(0, -groupHeight);
            }
          }
          else if (self.table.tBodies[0].rows[0] != previousRow || $(previousRow).is('.draggable')) {
            // Swap with the previous row (unless previous row is the first one
            // and undraggable).
            self.rowObject.swap('before', previousRow);
            self.rowObject.interval = null;
            self.rowObject.indent(0);
            window.scrollBy(0, -parseInt(item.offsetHeight, 10));
          }
          handle.get(0).focus(); // Regain focus after the DOM manipulation.
        }
        break;
      case 39: // Right arrow.
      case 63235: // Safari right arrow.
        keyChange = true;
        self.rowObject.indent(1 * self.rtl);
        break;
      case 40: // Down arrow.
      case 63233: // Safari down arrow.
        var nextRow = $(self.rowObject.group).filter(':last').next('tr').get(0);
        while (nextRow && $(nextRow).is(':hidden')) {
          nextRow = $(nextRow).next('tr').get(0);
        }
        if (nextRow) {
          self.safeBlur = false; // Do not allow the onBlur cleanup.
          self.rowObject.direction = 'down';
          keyChange = true;

          if ($(item).is('.tabledrag-root')) {
            // Swap with the next group (necessarily a top-level one).
            var groupHeight = 0;
            nextGroup = new self.row(nextRow, 'keyboard', self.indentEnabled, self.maxDepth, false);
            if (nextGroup) {
              $(nextGroup.group).each(function () {
                groupHeight += $(this).is(':hidden') ? 0 : this.offsetHeight;
              });
              nextGroupRow = $(nextGroup.group).filter(':last').get(0);
              self.rowObject.swap('after', nextGroupRow);
              // No need to check for indentation, 0 is the only valid one.
              window.scrollBy(0, parseInt(groupHeight, 10));
            }
          }
          else {
            // Swap with the next row.
            self.rowObject.swap('after', nextRow);
            self.rowObject.interval = null;
            self.rowObject.indent(0);
            window.scrollBy(0, parseInt(item.offsetHeight, 10));
          }
          handle.get(0).focus(); // Regain focus after the DOM manipulation.
        }
        break;
    }

    if (self.rowObject && self.rowObject.changed == true) {
      $(item).addClass('drag');
      if (self.oldRowElement) {
        $(self.oldRowElement).removeClass('drag-previous');
      }
      self.oldRowElement = item;
      self.restripeTable();
      self.onDrag();
    }

    // Returning false if we have an arrow key to prevent scrolling.
    if (keyChange) {
      return false;
    }
  });

  // Compatibility addition, return false on keypress to prevent unwanted scrolling.
  // IE and Safari will suppress scrolling on keydown, but all other browsers
  // need to return false on keypress. http://www.quirksmode.org/js/keys.html
  handle.keypress(function (event) {
    switch (event.keyCode) {
      case 37: // Left arrow.
      case 38: // Up arrow.
      case 39: // Right arrow.
      case 40: // Down arrow.
        return false;
    }
  });
};

/**
 * Mousemove event handler, bound to document.
 */
Drupal.tableDrag.prototype.dragRow = function (event, self) {
  if (self.dragObject) {
    self.currentMouseCoords = self.mouseCoords(event);

    var y = self.currentMouseCoords.y - self.dragObject.initMouseOffset.y;
    var x = self.currentMouseCoords.x - self.dragObject.initMouseOffset.x;

    // Check for row swapping and vertical scrolling.
    if (y != self.oldY) {
      self.rowObject.direction = y > self.oldY ? 'down' : 'up';
      self.oldY = y; // Update the old value.

      // Check if the window should be scrolled (and how fast).
      var scrollAmount = self.checkScroll(self.currentMouseCoords.y);
      // Stop any current scrolling.
      clearInterval(self.scrollInterval);
      // Continue scrolling if the mouse has moved in the scroll direction.
      if (scrollAmount > 0 && self.rowObject.direction == 'down' || scrollAmount < 0 && self.rowObject.direction == 'up') {
        self.setScroll(scrollAmount);
      }

      // If we have a valid target, perform the swap and restripe the table.
      var currentRow = self.findDropTargetRow(x, y);
      if (currentRow) {
        if (self.rowObject.direction == 'down') {
          self.rowObject.swap('after', currentRow, self);
        }
        else {
          self.rowObject.swap('before', currentRow, self);
        }
        self.restripeTable();
      }
    }

    // Similar to row swapping, handle indentations.
    if (self.indentEnabled) {
      var xDiff = self.currentMouseCoords.x - self.dragObject.indentMousePos.x;
      // Set the number of indentations the mouse has been moved left or right.
      var indentDiff = Math.round(xDiff / self.indentAmount * self.rtl);
      // Indent the row with our estimated diff, which may be further
      // restricted according to the rows around this row.
      var indentChange = self.rowObject.indent(indentDiff);
      // Update table and mouse indentations.
      self.dragObject.indentMousePos.x += self.indentAmount * indentChange * self.rtl;
      self.indentCount = Math.max(self.indentCount, self.rowObject.indents);
    }

    return false;
  }
};

/**
 * Mouseup event handler, bound to document.
 * Blur event handler, bound to drag handle for keyboard support.
 */
Drupal.tableDrag.prototype.dropRow = function (event, self) {
  // Drop row functionality shared between mouseup and blur events.
  if (self.rowObject != null) {
    var droppedRow = self.rowObject.element;
    // The row is already in the right place so we just release it.
    if (self.rowObject.changed == true) {
      // Update the fields in the dropped row.
      self.updateFields(droppedRow);

      // If a setting exists for affecting the entire group, update all the
      // fields in the entire dragged group.
      for (var group in self.tableSettings) {
        var rowSettings = self.rowSettings(group, droppedRow);
        if (rowSettings.relationship == 'group') {
          for (var n in self.rowObject.children) {
            self.updateField(self.rowObject.children[n], group);
          }
        }
      }

      self.rowObject.markChanged();
      if (self.changed == false) {
        $(Drupal.theme('tableDragChangedWarning')).insertBefore(self.table).hide().fadeIn('slow');
        self.changed = true;
      }
    }

    if (self.indentEnabled) {
      self.rowObject.removeIndentClasses();
    }
    if (self.oldRowElement) {
      $(self.oldRowElement).removeClass('drag-previous');
    }
    $(droppedRow).removeClass('drag').addClass('drag-previous');
    self.oldRowElement = droppedRow;
    self.onDrop();
    self.rowObject = null;
  }

  // Functionality specific only to mouseup event.
  if (self.dragObject != null) {
    $('.tabledrag-handle', droppedRow).removeClass('tabledrag-handle-hover');

    self.dragObject = null;
    $('body').removeClass('drag');
    clearInterval(self.scrollInterval);

    // Hack for IE6 that flickers uncontrollably if select lists are moved.
    if (navigator.userAgent.indexOf('MSIE 6.') != -1) {
      $('select', this.table).css('display', 'block');
    }
  }
};

/**
 * Get the mouse coordinates from the event (allowing for browser differences).
 */
Drupal.tableDrag.prototype.mouseCoords = function (event) {
  if (event.pageX || event.pageY) {
    return { x: event.pageX, y: event.pageY };
  }
  return {
    x: event.clientX + document.body.scrollLeft - document.body.clientLeft,
    y: event.clientY + document.body.scrollTop  - document.body.clientTop
  };
};

/**
 * Given a target element and a mouse event, get the mouse offset from that
 * element. To do this we need the element's position and the mouse position.
 */
Drupal.tableDrag.prototype.getMouseOffset = function (target, event) {
  var docPos   = $(target).offset();
  var mousePos = this.mouseCoords(event);
  return { x: mousePos.x - docPos.left, y: mousePos.y - docPos.top };
};

/**
 * Find the row the mouse is currently over. This row is then taken and swapped
 * with the one being dragged.
 *
 * @param x
 *   The x coordinate of the mouse on the page (not the screen).
 * @param y
 *   The y coordinate of the mouse on the page (not the screen).
 */
Drupal.tableDrag.prototype.findDropTargetRow = function (x, y) {
  var rows = $(this.table.tBodies[0].rows).not(':hidden');
  for (var n = 0; n < rows.length; n++) {
    var row = rows[n];
    var indentDiff = 0;
    var rowY = $(row).offset().top;
    // Because Safari does not report offsetHeight on table rows, but does on
    // table cells, grab the firstChild of the row and use that instead.
    // http://jacob.peargrove.com/blog/2006/technical/table-row-offsettop-bug-in-safari.
    if (row.offsetHeight == 0) {
      var rowHeight = parseInt(row.firstChild.offsetHeight, 10) / 2;
    }
    // Other browsers.
    else {
      var rowHeight = parseInt(row.offsetHeight, 10) / 2;
    }

    // Because we always insert before, we need to offset the height a bit.
    if ((y > (rowY - rowHeight)) && (y < (rowY + rowHeight))) {
      if (this.indentEnabled) {
        // Check that this row is not a child of the row being dragged.
        for (var n in this.rowObject.group) {
          if (this.rowObject.group[n] == row) {
            return null;
          }
        }
      }
      else {
        // Do not allow a row to be swapped with itself.
        if (row == this.rowObject.element) {
          return null;
        }
      }

      // Check that swapping with this row is allowed.
      if (!this.rowObject.isValidSwap(row)) {
        return null;
      }

      // We may have found the row the mouse just passed over, but it doesn't
      // take into account hidden rows. Skip backwards until we find a draggable
      // row.
      while ($(row).is(':hidden') && $(row).prev('tr').is(':hidden')) {
        row = $(row).prev('tr').get(0);
      }
      return row;
    }
  }
  return null;
};

/**
 * After the row is dropped, update the table fields according to the settings
 * set for this table.
 *
 * @param changedRow
 *   DOM object for the row that was just dropped.
 */
Drupal.tableDrag.prototype.updateFields = function (changedRow) {
  for (var group in this.tableSettings) {
    // Each group may have a different setting for relationship, so we find
    // the source rows for each separately.
    this.updateField(changedRow, group);
  }
};

/**
 * After the row is dropped, update a single table field according to specific
 * settings.
 *
 * @param changedRow
 *   DOM object for the row that was just dropped.
 * @param group
 *   The settings group on which field updates will occur.
 */
Drupal.tableDrag.prototype.updateField = function (changedRow, group) {
  var rowSettings = this.rowSettings(group, changedRow);

  // Set the row as its own target.
  if (rowSettings.relationship == 'self' || rowSettings.relationship == 'group') {
    var sourceRow = changedRow;
  }
  // Siblings are easy, check previous and next rows.
  else if (rowSettings.relationship == 'sibling') {
    var previousRow = $(changedRow).prev('tr').get(0);
    var nextRow = $(changedRow).next('tr').get(0);
    var sourceRow = changedRow;
    if ($(previousRow).is('.draggable') && $('.' + group, previousRow).length) {
      if (this.indentEnabled) {
        if ($('.indentations', previousRow).size() == $('.indentations', changedRow)) {
          sourceRow = previousRow;
        }
      }
      else {
        sourceRow = previousRow;
      }
    }
    else if ($(nextRow).is('.draggable') && $('.' + group, nextRow).length) {
      if (this.indentEnabled) {
        if ($('.indentations', nextRow).size() == $('.indentations', changedRow)) {
          sourceRow = nextRow;
        }
      }
      else {
        sourceRow = nextRow;
      }
    }
  }
  // Parents, look up the tree until we find a field not in this group.
  // Go up as many parents as indentations in the changed row.
  else if (rowSettings.relationship == 'parent') {
    var previousRow = $(changedRow).prev('tr');
    while (previousRow.length && $('.indentation', previousRow).length >= this.rowObject.indents) {
      previousRow = previousRow.prev('tr');
    }
    // If we found a row.
    if (previousRow.length) {
      sourceRow = previousRow[0];
    }
    // Otherwise we went all the way to the left of the table without finding
    // a parent, meaning this item has been placed at the root level.
    else {
      // Use the first row in the table as source, because it's guaranteed to
      // be at the root level. Find the first item, then compare this row
      // against it as a sibling.
      sourceRow = $(this.table).find('tr.draggable:first').get(0);
      if (sourceRow == this.rowObject.element) {
        sourceRow = $(this.rowObject.group[this.rowObject.group.length - 1]).next('tr.draggable').get(0);
      }
      var useSibling = true;
    }
  }

  // Because we may have moved the row from one category to another,
  // take a look at our sibling and borrow its sources and targets.
  this.copyDragClasses(sourceRow, changedRow, group);
  rowSettings = this.rowSettings(group, changedRow);

  // In the case that we're looking for a parent, but the row is at the top
  // of the tree, copy our sibling's values.
  if (useSibling) {
    rowSettings.relationship = 'sibling';
    rowSettings.source = rowSettings.target;
  }

  var targetClass = '.' + rowSettings.target;
  var targetElement = $(targetClass, changedRow).get(0);

  // Check if a target element exists in this row.
  if (targetElement) {
    var sourceClass = '.' + rowSettings.source;
    var sourceElement = $(sourceClass, sourceRow).get(0);
    switch (rowSettings.action) {
      case 'depth':
        // Get the depth of the target row.
        targetElement.value = $('.indentation', $(sourceElement).parents('tr:first')).size();
        break;
      case 'match':
        // Update the value.
        targetElement.value = sourceElement.value;
        break;
      case 'order':
        var siblings = this.rowObject.findSiblings(rowSettings);
        if ($(targetElement).is('select')) {
          // Get a list of acceptable values.
          var values = [];
          $('option', targetElement).each(function () {
            values.push(this.value);
          });
          var maxVal = values[values.length - 1];
          // Populate the values in the siblings.
          $(targetClass, siblings).each(function () {
            // If there are more items than possible values, assign the maximum value to the row.
            if (values.length > 0) {
              this.value = values.shift();
            }
            else {
              this.value = maxVal;
            }
          });
        }
        else {
          // Assume a numeric input field.
          var weight = parseInt($(targetClass, siblings[0]).val(), 10) || 0;
          $(targetClass, siblings).each(function () {
            this.value = weight;
            weight++;
          });
        }
        break;
    }
  }
};

/**
 * Copy all special tableDrag classes from one row's form elements to a
 * different one, removing any special classes that the destination row
 * may have had.
 */
Drupal.tableDrag.prototype.copyDragClasses = function (sourceRow, targetRow, group) {
  var sourceElement = $('.' + group, sourceRow);
  var targetElement = $('.' + group, targetRow);
  if (sourceElement.length && targetElement.length) {
    targetElement[0].className = sourceElement[0].className;
  }
};

Drupal.tableDrag.prototype.checkScroll = function (cursorY) {
  var de  = document.documentElement;
  var b  = document.body;

  var windowHeight = this.windowHeight = window.innerHeight || (de.clientHeight && de.clientWidth != 0 ? de.clientHeight : b.offsetHeight);
  var scrollY = this.scrollY = (document.all ? (!de.scrollTop ? b.scrollTop : de.scrollTop) : (window.pageYOffset ? window.pageYOffset : window.scrollY));
  var trigger = this.scrollSettings.trigger;
  var delta = 0;

  // Return a scroll speed relative to the edge of the screen.
  if (cursorY - scrollY > windowHeight - trigger) {
    delta = trigger / (windowHeight + scrollY - cursorY);
    delta = (delta > 0 && delta < trigger) ? delta : trigger;
    return delta * this.scrollSettings.amount;
  }
  else if (cursorY - scrollY < trigger) {
    delta = trigger / (cursorY - scrollY);
    delta = (delta > 0 && delta < trigger) ? delta : trigger;
    return -delta * this.scrollSettings.amount;
  }
};

Drupal.tableDrag.prototype.setScroll = function (scrollAmount) {
  var self = this;

  this.scrollInterval = setInterval(function () {
    // Update the scroll values stored in the object.
    self.checkScroll(self.currentMouseCoords.y);
    var aboveTable = self.scrollY > self.table.topY;
    var belowTable = self.scrollY + self.windowHeight < self.table.bottomY;
    if (scrollAmount > 0 && belowTable || scrollAmount < 0 && aboveTable) {
      window.scrollBy(0, scrollAmount);
    }
  }, this.scrollSettings.interval);
};

Drupal.tableDrag.prototype.restripeTable = function () {
  // :even and :odd are reversed because jQuery counts from 0 and
  // we count from 1, so we're out of sync.
  // Match immediate children of the parent element to allow nesting.
  $('> tbody > tr.draggable:visible, > tr.draggable:visible', this.table)
    .removeClass('odd even')
    .filter(':odd').addClass('even').end()
    .filter(':even').addClass('odd');
};

/**
 * Stub function. Allows a custom handler when a row begins dragging.
 */
Drupal.tableDrag.prototype.onDrag = function () {
  return null;
};

/**
 * Stub function. Allows a custom handler when a row is dropped.
 */
Drupal.tableDrag.prototype.onDrop = function () {
  return null;
};

/**
 * Constructor to make a new object to manipulate a table row.
 *
 * @param tableRow
 *   The DOM element for the table row we will be manipulating.
 * @param method
 *   The method in which this row is being moved. Either 'keyboard' or 'mouse'.
 * @param indentEnabled
 *   Whether the containing table uses indentations. Used for optimizations.
 * @param maxDepth
 *   The maximum amount of indentations this row may contain.
 * @param addClasses
 *   Whether we want to add classes to this row to indicate child relationships.
 */
Drupal.tableDrag.prototype.row = function (tableRow, method, indentEnabled, maxDepth, addClasses) {
  this.element = tableRow;
  this.method = method;
  this.group = [tableRow];
  this.groupDepth = $('.indentation', tableRow).size();
  this.changed = false;
  this.table = $(tableRow).parents('table:first').get(0);
  this.indentEnabled = indentEnabled;
  this.maxDepth = maxDepth;
  this.direction = ''; // Direction the row is being moved.

  if (this.indentEnabled) {
    this.indents = $('.indentation', tableRow).size();
    this.children = this.findChildren(addClasses);
    this.group = $.merge(this.group, this.children);
    // Find the depth of this entire group.
    for (var n = 0; n < this.group.length; n++) {
      this.groupDepth = Math.max($('.indentation', this.group[n]).size(), this.groupDepth);
    }
  }
};

/**
 * Find all children of rowObject by indentation.
 *
 * @param addClasses
 *   Whether we want to add classes to this row to indicate child relationships.
 */
Drupal.tableDrag.prototype.row.prototype.findChildren = function (addClasses) {
  var parentIndentation = this.indents;
  var currentRow = $(this.element, this.table).next('tr.draggable');
  var rows = [];
  var child = 0;
  while (currentRow.length) {
    var rowIndentation = $('.indentation', currentRow).length;
    // A greater indentation indicates this is a child.
    if (rowIndentation > parentIndentation) {
      child++;
      rows.push(currentRow[0]);
      if (addClasses) {
        $('.indentation', currentRow).each(function (indentNum) {
          if (child == 1 && (indentNum == parentIndentation)) {
            $(this).addClass('tree-child-first');
          }
          if (indentNum == parentIndentation) {
            $(this).addClass('tree-child');
          }
          else if (indentNum > parentIndentation) {
            $(this).addClass('tree-child-horizontal');
          }
        });
      }
    }
    else {
      break;
    }
    currentRow = currentRow.next('tr.draggable');
  }
  if (addClasses && rows.length) {
    $('.indentation:nth-child(' + (parentIndentation + 1) + ')', rows[rows.length - 1]).addClass('tree-child-last');
  }
  return rows;
};

/**
 * Ensure that two rows are allowed to be swapped.
 *
 * @param row
 *   DOM object for the row being considered for swapping.
 */
Drupal.tableDrag.prototype.row.prototype.isValidSwap = function (row) {
  if (this.indentEnabled) {
    var prevRow, nextRow;
    if (this.direction == 'down') {
      prevRow = row;
      nextRow = $(row).next('tr').get(0);
    }
    else {
      prevRow = $(row).prev('tr').get(0);
      nextRow = row;
    }
    this.interval = this.validIndentInterval(prevRow, nextRow);

    // We have an invalid swap if the valid indentations interval is empty.
    if (this.interval.min > this.interval.max) {
      return false;
    }
  }

  // Do not let an un-draggable first row have anything put before it.
  if (this.table.tBodies[0].rows[0] == row && $(row).is(':not(.draggable)')) {
    return false;
  }

  return true;
};

/**
 * Perform the swap between two rows.
 *
 * @param position
 *   Whether the swap will occur 'before' or 'after' the given row.
 * @param row
 *   DOM element what will be swapped with the row group.
 */
Drupal.tableDrag.prototype.row.prototype.swap = function (position, row) {
  Drupal.detachBehaviors(this.group, Drupal.settings, 'move');
  $(row)[position](this.group);
  Drupal.attachBehaviors(this.group, Drupal.settings);
  this.changed = true;
  this.onSwap(row);
};

/**
 * Determine the valid indentations interval for the row at a given position
 * in the table.
 *
 * @param prevRow
 *   DOM object for the row before the tested position
 *   (or null for first position in the table).
 * @param nextRow
 *   DOM object for the row after the tested position
 *   (or null for last position in the table).
 */
Drupal.tableDrag.prototype.row.prototype.validIndentInterval = function (prevRow, nextRow) {
  var minIndent, maxIndent;

  // Minimum indentation:
  // Do not orphan the next row.
  minIndent = nextRow ? $('.indentation', nextRow).size() : 0;

  // Maximum indentation:
  if (!prevRow || $(prevRow).is(':not(.draggable)') || $(this.element).is('.tabledrag-root')) {
    // Do not indent:
    // - the first row in the table,
    // - rows dragged below a non-draggable row,
    // - 'root' rows.
    maxIndent = 0;
  }
  else {
    // Do not go deeper than as a child of the previous row.
    maxIndent = $('.indentation', prevRow).size() + ($(prevRow).is('.tabledrag-leaf') ? 0 : 1);
    // Limit by the maximum allowed depth for the table.
    if (this.maxDepth) {
      maxIndent = Math.min(maxIndent, this.maxDepth - (this.groupDepth - this.indents));
    }
  }

  return { 'min': minIndent, 'max': maxIndent };
};

/**
 * Indent a row within the legal bounds of the table.
 *
 * @param indentDiff
 *   The number of additional indentations proposed for the row (can be
 *   positive or negative). This number will be adjusted to nearest valid
 *   indentation level for the row.
 */
Drupal.tableDrag.prototype.row.prototype.indent = function (indentDiff) {
  // Determine the valid indentations interval if not available yet.
  if (!this.interval) {
    prevRow = $(this.element).prev('tr').get(0);
    nextRow = $(this.group).filter(':last').next('tr').get(0);
    this.interval = this.validIndentInterval(prevRow, nextRow);
  }

  // Adjust to the nearest valid indentation.
  var indent = this.indents + indentDiff;
  indent = Math.max(indent, this.interval.min);
  indent = Math.min(indent, this.interval.max);
  indentDiff = indent - this.indents;

  for (var n = 1; n <= Math.abs(indentDiff); n++) {
    // Add or remove indentations.
    if (indentDiff < 0) {
      $('.indentation:first', this.group).remove();
      this.indents--;
    }
    else {
      $('td:first', this.group).prepend(Drupal.theme('tableDragIndentation'));
      this.indents++;
    }
  }
  if (indentDiff) {
    // Update indentation for this row.
    this.changed = true;
    this.groupDepth += indentDiff;
    this.onIndent();
  }

  return indentDiff;
};

/**
 * Find all siblings for a row, either according to its subgroup or indentation.
 * Note that the passed-in row is included in the list of siblings.
 *
 * @param settings
 *   The field settings we're using to identify what constitutes a sibling.
 */
Drupal.tableDrag.prototype.row.prototype.findSiblings = function (rowSettings) {
  var siblings = [];
  var directions = ['prev', 'next'];
  var rowIndentation = this.indents;
  for (var d = 0; d < directions.length; d++) {
    var checkRow = $(this.element)[directions[d]]();
    while (checkRow.length) {
      // Check that the sibling contains a similar target field.
      if ($('.' + rowSettings.target, checkRow)) {
        // Either add immediately if this is a flat table, or check to ensure
        // that this row has the same level of indentation.
        if (this.indentEnabled) {
          var checkRowIndentation = $('.indentation', checkRow).length;
        }

        if (!(this.indentEnabled) || (checkRowIndentation == rowIndentation)) {
          siblings.push(checkRow[0]);
        }
        else if (checkRowIndentation < rowIndentation) {
          // No need to keep looking for siblings when we get to a parent.
          break;
        }
      }
      else {
        break;
      }
      checkRow = $(checkRow)[directions[d]]();
    }
    // Since siblings are added in reverse order for previous, reverse the
    // completed list of previous siblings. Add the current row and continue.
    if (directions[d] == 'prev') {
      siblings.reverse();
      siblings.push(this.element);
    }
  }
  return siblings;
};

/**
 * Remove indentation helper classes from the current row group.
 */
Drupal.tableDrag.prototype.row.prototype.removeIndentClasses = function () {
  for (var n in this.children) {
    $('.indentation', this.children[n])
      .removeClass('tree-child')
      .removeClass('tree-child-first')
      .removeClass('tree-child-last')
      .removeClass('tree-child-horizontal');
  }
};

/**
 * Add an asterisk or other marker to the changed row.
 */
Drupal.tableDrag.prototype.row.prototype.markChanged = function () {
  var marker = Drupal.theme('tableDragChangedMarker');
  var cell = $('td:first', this.element);
  if ($('span.tabledrag-changed', cell).length == 0) {
    cell.append(marker);
  }
};

/**
 * Stub function. Allows a custom handler when a row is indented.
 */
Drupal.tableDrag.prototype.row.prototype.onIndent = function () {
  return null;
};

/**
 * Stub function. Allows a custom handler when a row is swapped.
 */
Drupal.tableDrag.prototype.row.prototype.onSwap = function (swappedRow) {
  return null;
};

Drupal.theme.prototype.tableDragChangedMarker = function () {
  return '<span class="warning tabledrag-changed">*</span>';
};

Drupal.theme.prototype.tableDragIndentation = function () {
  return '<div class="indentation">&nbsp;</div>';
};

Drupal.theme.prototype.tableDragChangedWarning = function () {
  return '<div class="tabledrag-changed-warning messages warning">' + Drupal.theme('tableDragChangedMarker') + ' ' + Drupal.t('Changes made in this table will not be saved until the form is submitted.') + '</div>';
};

})(jQuery);
;
Drupal.locale = { 'pluralFormula': function ($n) { return Number(($n!=1)); }, 'strings': {"An AJAX HTTP error occurred.":"Ocorreu um erro HTTP no AJAX","HTTP Result Code: !status":"C\u00f3digo do Resultado HTTP:  !status","An AJAX HTTP request terminated abnormally.":"Uma requisi\u00e7\u00e3o HTTP AJAX terminou de forma anormal.","Debugging information follows.":"Estas s\u00e3o as informa\u00e7\u00f5es de depura\u00e7\u00e3o.","Path: !uri":"Caminho: !url","StatusText: !statusText":"Texto de Status: !statusText","ResponseText: !responseText":"Texto de Resposta: !responseText","ReadyState: !readyState":"ReadyState: !readyState","Loading":"Carregando","(active tab)":"(aba ativa)","Hide":"Ocultar","Show":"Exibir","@title dialog":"Di\u00e1logo @title","Configure":"Configurar","Show shortcuts":"Mostrar atalhos","Hide shortcuts":"Esconder atalhos","Re-order rows by numerical weight instead of dragging.":"Re-ordernar as linhas por campos n\u00famericos de peso ao inv\u00e9s de arrastar-e-soltar.","Show row weights":"Exibir pesos das linhas","Hide row weights":"Ocultar pesos das linhas","Drag to re-order":"Arraste para reordenar","Changes made in this table will not be saved until the form is submitted.":"Mudan\u00e7as feitas nesta tabela n\u00e3o ser\u00e3o salvas at\u00e9 que o formul\u00e1rio seja enviado.","Next":"Pr\u00f3ximo","Disabled":"Desativado","Enabled":"Ativado","Edit":"Editar","Search":"Buscar","This action cannot be undone.":"Esta opera\u00e7\u00e3o n\u00e3o poder\u00e1 ser desfeita.","Done":"Conclu\u00eddo","OK":"OK","Select all rows in this table":"Selecionar todas as linhas da tabela","Deselect all rows in this table":"Desmarcar todas as linhas da tabela","Not published":"N\u00e3o publicado","Please wait...":"Por favor, espere um pouco...","Not in book":"Fora do livro","New book":"Novo livro","By @name on @date":"Por @name em @date","By @name":"Por @name","Not in menu":"Fora do menu","Alias: @alias":"URL Alternativa: @alias","No alias":"Nenhuma URL alternativa","New revision":"Nova revis\u00e3o","The changes to these blocks will not be saved until the \u003cem\u003eSave blocks\u003c\/em\u003e button is clicked.":"As altera\u00e7\u00f5es nesses blocos n\u00e3o v\u00e3o ser salvas enquanto o bot\u00e3o \u003cem\u003eSalvar Blocos\u003c\/em\u003e n\u00e3o for clicado.","This permission is inherited from the authenticated user role.":"Essa permiss\u00e3o \u00e9 herdada do papel de usu\u00e1rio autenticado.","No revision":"Sem revis\u00e3o","@number comments per page":"@number coment\u00e1rios por p\u00e1gina","Not restricted":"Sem restri\u00e7\u00f5es","Not customizable":"N\u00e3o \u00e9 personaliz\u00e1vel","Restricted to certain pages":"Restrito para certas p\u00e1ginas","The block cannot be placed in this region.":"O bloco n\u00e3o pode ser colocado nessa regi\u00e3o.","Customize dashboard":"Personalizar painel","Hide summary":"Ocultar sum\u00e1rio","Edit summary":"Editar resumo","The selected file %filename cannot be uploaded. Only files with the following extensions are allowed: %extensions.":"O arquivo selecionado %filename n\u00e3o p\u00f4de ser transferido. Somente arquivos com as seguintes extens\u00f5es s\u00e3o permitidos: %extensions.","Autocomplete popup":"Popup de autocompletar","Searching for matches...":"Procurando por dados correspondentes..."} };;

(function ($) {
  Drupal.Panels = {};

  Drupal.Panels.autoAttach = function() {
    if ($.browser.msie) {
      // If IE, attach a hover event so we can see our admin links.
      $("div.panel-pane").hover(
        function() {
          $('div.panel-hide', this).addClass("panel-hide-hover"); return true;
        },
        function() {
          $('div.panel-hide', this).removeClass("panel-hide-hover"); return true;
        }
      );
      $("div.admin-links").hover(
        function() {
          $(this).addClass("admin-links-hover"); return true;
        },
        function(){
          $(this).removeClass("admin-links-hover"); return true;
        }
      );
    }
  };

  $(Drupal.Panels.autoAttach);
})(jQuery);
;
(function($){
Drupal.behaviors.contextReactionBlock = {attach: function(context) {
  $('form.context-editor:not(.context-block-processed)')
    .addClass('context-block-processed')
    .each(function() {
      var id = $(this).attr('id');
      Drupal.contextBlockEditor = Drupal.contextBlockEditor || {};
      $(this).bind('init.pageEditor', function(event) {
        Drupal.contextBlockEditor[id] = new DrupalContextBlockEditor($(this));
      });
      $(this).bind('start.pageEditor', function(event, context) {
        // Fallback to first context if param is empty.
        if (!context) {
          context = $(this).data('defaultContext');
        }
        Drupal.contextBlockEditor[id].editStart($(this), context);
      });
      $(this).bind('end.pageEditor', function(event) {
        Drupal.contextBlockEditor[id].editFinish();
      });
    });

  //
  // Admin Form =======================================================
  //
  // ContextBlockForm: Init.
  $('#context-blockform:not(.processed)').each(function() {
    $(this).addClass('processed');
    Drupal.contextBlockForm = new DrupalContextBlockForm($(this));
    Drupal.contextBlockForm.setState();
  });

  // ContextBlockForm: Attach block removal handlers.
  // Lives in behaviors as it may be required for attachment to new DOM elements.
  $('#context-blockform a.remove:not(.processed)').each(function() {
    $(this).addClass('processed');
    $(this).click(function() {
      $(this).parents('tr').eq(0).remove();
      Drupal.contextBlockForm.setState();
      return false;
    });
  });
}};

/**
 * Context block form. Default form for editing context block reactions.
 */
DrupalContextBlockForm = function(blockForm) {
  this.state = {};

  this.setState = function() {
    $('table.context-blockform-region', blockForm).each(function() {
      var region = $(this).attr('id').split('context-blockform-region-')[1];
      var blocks = [];
      $('tr', $(this)).each(function() {
        var bid = $(this).attr('id');
        var weight = $(this).find('select').val();
        blocks.push({'bid' : bid, 'weight' : weight});
      });
      Drupal.contextBlockForm.state[region] = blocks;
    });

    // Serialize here and set form element value.
    $('form input.context-blockform-state').val(JSON.stringify(this.state));

    // Hide enabled blocks from selector that are used
    $('table.context-blockform-region tr').each(function() {
      var bid = $(this).attr('id');
      $('div.context-blockform-selector input[value='+bid+']').parents('div.form-item').eq(0).hide();
    });
    // Show blocks in selector that are unused
    $('div.context-blockform-selector input').each(function() {
      var bid = $(this).val();
      if ($('table.context-blockform-region tr#'+bid).size() === 0) {
        $(this).parents('div.form-item').eq(0).show();
      }
    });
  };

  // make sure we update the state right before submits, this takes care of an
  // apparent race condition between saving the state and the weights getting set
  // by tabledrag
  $('#ctools-export-ui-edit-item-form').submit(function() { Drupal.contextBlockForm.setState(); });

  // Tabledrag
  // Add additional handlers to update our blocks.
  $.each(Drupal.settings.tableDrag, function(base) {
    var table = $('#' + base + ':not(.processed)', blockForm);
    if (table && table.is('.context-blockform-region')) {
      table.addClass('processed');
      table.bind('mouseup', function(event) {
        Drupal.contextBlockForm.setState();
        return;
      });
    }
  });

  // Add blocks to a region
  $('td.blocks a', blockForm).each(function() {
    $(this).click(function() {
      var region = $(this).attr('href').split('#')[1];
      var selected = $("div.context-blockform-selector input:checked");
      if (selected.size() > 0) {
        selected.each(function() {
          // create new block markup
          var block = document.createElement('tr');
          var text = $(this).parents('div.form-item').eq(0).hide().children('label').text();
          var select = '<div class="form-item form-type-select"><select class="tabledrag-hide form-select">';
          var i;
          for (i = -10; i < 10; ++i) {
            select += '<option>' + i + '</option>';
          }
          select += '</select></div>';
          $(block).attr('id', $(this).attr('value')).addClass('draggable');
          $(block).html("<td>"+ text + "</td><td>" + select + "</td><td><a href='' class='remove'>X</a></td>");

          // add block item to region
          var base = "context-blockform-region-"+ region;
          Drupal.tableDrag[base].makeDraggable(block);
          $('table#'+base).append(block);
          if ($.cookie('Drupal.tableDrag.showWeight') == 1) {
            $('table#'+base).find('.tabledrag-hide').css('display', '');
            $('table#'+base).find('.tabledrag-handle').css('display', 'none');
          }
          else {
            $('table#'+base).find('.tabledrag-hide').css('display', 'none');
            $('table#'+base).find('.tabledrag-handle').css('display', '');
          }
          Drupal.attachBehaviors($('table#'+base));

          Drupal.contextBlockForm.setState();
          $(this).removeAttr('checked');
        });
      }
      return false;
    });
  });
};

/**
 * Context block editor. AHAH editor for live block reaction editing.
 */
DrupalContextBlockEditor = function(editor) {
  this.editor = editor;
  this.state = {};
  this.blocks = {};
  this.regions = {};

  // Category selector handler.
  // Also set to "Choose a category" option as browsers can retain
  // form values from previous page load.
  $('select.context-block-browser-categories', editor).change(function() {
    var category = $(this).val();
    var params = {
      containment: 'document',
      revert: true,
      dropOnEmpty: true,
      placeholder: 'draggable-placeholder',
      forcePlaceholderSize: true,
      helper: 'clone',
      appendTo: 'body',
      connectWith: ($.ui.version === '1.6') ? ['.ui-sortable'] : '.ui-sortable'
    };
    $('div.category', editor).hide().sortable('destroy');
    $('div.category-'+category, editor).show().sortable(params);
  });
  $('select.context-block-browser-categories', editor).val(0).change();

  return this;
};

DrupalContextBlockEditor.prototype.initBlocks = function(blocks) {
  var self = this;
  this.blocks = blocks;
  blocks.each(function() {
    $(this).addClass('draggable');
    $(this).prepend($('<a class="context-block-handle"></a>'));
    $(this).prepend($('<a class="context-block-remove"></a>').click(function() {
      $(this).parents('div.block').eq(0).fadeOut('medium', function() {
        $(this).remove();
        self.updateBlocks();
      });
      return false;
    }));
  });
};

DrupalContextBlockEditor.prototype.initRegions = function(regions) {
  this.regions = regions;
};

/**
  * Update UI to match the current block states.
  */
DrupalContextBlockEditor.prototype.updateBlocks = function() {
  var browser = $('div.context-block-browser');

  // For all enabled blocks, mark corresponding addables as having been added.
  $('div.block, div.admin-block').each(function() {
    var bid = $(this).attr('id').split('block-')[1]; // Ugh.
    $('#context-block-addable-'+bid, browser).draggable('disable').addClass('context-block-added').removeClass('context-block-addable');
  });
  // For all hidden addables with no corresponding blocks, mark as addable.
  $('.context-block-item', browser).each(function() {
    var bid = $(this).attr('id').split('context-block-addable-')[1];
    if ($('#block-'+bid).size() === 0) {
      $(this).draggable('enable').removeClass('context-block-added').addClass('context-block-addable');
    }
  });

  // Mark empty regions.
  $(this.regions).each(function() {
    if ($('div.block:has(a.context-block)', this).size() > 0) {
      $(this).removeClass('context-block-region-empty');
    }
    else {
      $(this).addClass('context-block-region-empty');
    }
  });
};

/**
  * Live update a region.
  */
DrupalContextBlockEditor.prototype.updateRegion = function(event, ui, region, op) {
  switch (op) {
    case 'over':
      $(region).removeClass('context-block-region-empty');
      break;
    case 'out':
      if (
        // jQuery UI 1.8
        $('div.draggable-placeholder', region).size() === 1 &&
        $('div.block:has(a.context-block)', region).size() == 0
        // jQuery UI 1.6
        // $('div.draggable-placeholder', region).size() === 0 &&
        // $('div.block:has(a.context-block)', region).size() == 1 &&
        // $('div.block:has(a.context-block)', region).attr('id') == ui.item.attr('id')
      ) {
        $(region).addClass('context-block-region-empty');
      }
      break;
  }
};

/**
  * Remove script elements while dragging & dropping.
  */
DrupalContextBlockEditor.prototype.scriptFix = function(event, ui, editor, context) {
  if ($('script', ui.item)) {
    var placeholder = $(Drupal.settings.contextBlockEditor.scriptPlaceholder);
    var label = $('div.handle label', ui.item).text();
    placeholder.children('strong').html(label);
    $('script', ui.item).parent().empty().append(placeholder);
  }
};

/**
  * Add a block to a region through an AHAH load of the block contents.
  */
DrupalContextBlockEditor.prototype.addBlock = function(event, ui, editor, context) {
  var self = this;
  if (ui.item.is('.context-block-addable')) {
    var bid = ui.item.attr('id').split('context-block-addable-')[1];

    // Construct query params for our AJAX block request.
    var params = Drupal.settings.contextBlockEditor.params;
    params.context_block = bid + ',' + context;

    // Replace item with loading block.
    var blockLoading = $('<div class="context-block-item context-block-loading"><span class="icon"></span></div>');
    ui.item.addClass('context-block-added');
    ui.item.after(blockLoading);
    ui.sender.append(ui.item);

    $.getJSON(Drupal.settings.contextBlockEditor.path, params, function(data) {
      if (data.status) {
        var newBlock = $(data.block);
        if ($('script', newBlock)) {
          $('script', newBlock).remove();
        }
        blockLoading.fadeOut(function() {
          $(this).replaceWith(newBlock);
          self.initBlocks(newBlock);
          self.updateBlocks();
          Drupal.attachBehaviors();
        });
      }
      else {
        blockLoading.fadeOut(function() { $(this).remove(); });
      }
    });
  }
  else if (ui.item.is(':has(a.context-block)')) {
    self.updateBlocks();
  }
};

/**
  * Update form hidden field with JSON representation of current block visibility states.
  */
DrupalContextBlockEditor.prototype.setState = function() {
  var self = this;

  $(this.regions).each(function() {
    var region = $('a.context-block-region', this).attr('id').split('context-block-region-')[1];
    var blocks = [];
    $('a.context-block', $(this)).each(function() {
      if ($(this).attr('class').indexOf('edit-') != -1) {
        var bid = $(this).attr('id').split('context-block-')[1];
        var context = $(this).attr('class').split('edit-')[1].split(' ')[0];
        context = context ? context : 0;
        var block = {'bid': bid, 'context': context};
        blocks.push(block);
      }
    });
    self.state[region] = blocks;
  });

  // Serialize here and set form element value.
  $('input.context-block-editor-state', this.editor).val(JSON.stringify(this.state));
};

/**
  * Disable text selection.
  */
DrupalContextBlockEditor.prototype.disableTextSelect = function() {
  if ($.browser.safari) {
    $('div.block:has(a.context-block):not(:has(input,textarea))').css('WebkitUserSelect','none');
  }
  else if ($.browser.mozilla) {
    $('div.block:has(a.context-block):not(:has(input,textarea))').css('MozUserSelect','none');
  }
  else if ($.browser.msie) {
    $('div.block:has(a.context-block):not(:has(input,textarea))').bind('selectstart.contextBlockEditor', function() { return false; });
  }
  else {
    $(this).bind('mousedown.contextBlockEditor', function() { return false; });
  }
};

/**
  * Enable text selection.
  */
DrupalContextBlockEditor.prototype.enableTextSelect = function() {
  if ($.browser.safari) {
    $('*').css('WebkitUserSelect','');
  }
  else if ($.browser.mozilla) {
    $('*').css('MozUserSelect','');
  }
  else if ($.browser.msie) {
    $('*').unbind('selectstart.contextBlockEditor');
  }
  else {
    $(this).unbind('mousedown.contextBlockEditor');
  }
};

/**
  * Start editing. Attach handlers, begin draggable/sortables.
  */
DrupalContextBlockEditor.prototype.editStart = function(editor, context) {
  var self = this;

  // This is redundant to the start handler found in context_ui.js.
  // However it's necessary that we trigger this class addition before
  // we call .sortable() as the empty regions need to be visible.
  $(document.body).addClass('context-editing');
  this.editor.addClass('context-editing');

  this.disableTextSelect();
  this.initBlocks($('div.block:has(a.context-block.edit-'+context+')'));
  this.initRegions($('a.context-block-region').parent());
  this.updateBlocks();

  // First pass, enable sortables on all regions.
  $(this.regions).each(function() {
    var region = $(this);
    var params = {
      containment: 'document',
      revert: true,
      dropOnEmpty: true,
      placeholder: 'draggable-placeholder',
      forcePlaceholderSize: true,
      items: '> div.block:has(a.context-block.editable)',
      handle: 'a.context-block-handle',
      start: function(event, ui) { self.scriptFix(event, ui, editor, context); },
      stop: function(event, ui) { self.addBlock(event, ui, editor, context); },
      receive: function(event, ui) { self.addBlock(event, ui, editor, context); },
      over: function(event, ui) { self.updateRegion(event, ui, region, 'over'); },
      out: function(event, ui) { self.updateRegion(event, ui, region, 'out'); }
    };
    region.sortable(params);
  });

  // Second pass, hook up all regions via connectWith to each other.
  $(this.regions).each(function() {
    $(this).sortable('option', 'connectWith', ['.ui-sortable']);
  });

  // Terrible, terrible workaround for parentoffset issue in Safari.
  // The proper fix for this issue has been committed to jQuery UI, but was
  // not included in the 1.6 release. Therefore, we do a browser agent hack
  // to ensure that Safari users are covered by the offset fix found here:
  // http://dev.jqueryui.com/changeset/2073.
  if ($.ui.version === '1.6' && $.browser.safari) {
    $.browser.mozilla = true;
  }
};

/**
  * Finish editing. Remove handlers.
  */
DrupalContextBlockEditor.prototype.editFinish = function() {
  this.editor.removeClass('context-editing');
  this.enableTextSelect();

  // Remove UI elements.
  $(this.blocks).each(function() {
    $('a.context-block-handle, a.context-block-remove', this).remove();
    $(this).removeClass('draggable');
  });
  this.regions.sortable('destroy');

  this.setState();

  // Unhack the user agent.
  if ($.ui.version === '1.6' && $.browser.safari) {
    $.browser.mozilla = false;
  }
};

})(jQuery);
;
(function ($) {

Drupal.behaviors.textarea = {
  attach: function (context, settings) {
    $('.form-textarea-wrapper.resizable', context).once('textarea', function () {
      var staticOffset = null;
      var textarea = $(this).addClass('resizable-textarea').find('textarea');
      var grippie = $('<div class="grippie"></div>').mousedown(startDrag);

      grippie.insertAfter(textarea);

      function startDrag(e) {
        staticOffset = textarea.height() - e.pageY;
        textarea.css('opacity', 0.25);
        $(document).mousemove(performDrag).mouseup(endDrag);
        return false;
      }

      function performDrag(e) {
        textarea.height(Math.max(32, staticOffset + e.pageY) + 'px');
        return false;
      }

      function endDrag(e) {
        $(document).unbind('mousemove', performDrag).unbind('mouseup', endDrag);
        textarea.css('opacity', 1);
      }
    });
  }
};

})(jQuery);
;
(function ($) {

/**
 * Attaches sticky table headers.
 */
Drupal.behaviors.tableHeader = {
  attach: function (context, settings) {
    if (!$.support.positionFixed) {
      return;
    }

    $('table.sticky-enabled', context).once('tableheader', function () {
      $(this).data("drupal-tableheader", new Drupal.tableHeader(this));
    });
  }
};

/**
 * Constructor for the tableHeader object. Provides sticky table headers.
 *
 * @param table
 *   DOM object for the table to add a sticky header to.
 */
Drupal.tableHeader = function (table) {
  var self = this;

  this.originalTable = $(table);
  this.originalHeader = $(table).children('thead');
  this.originalHeaderCells = this.originalHeader.find('> tr > th');

  // Clone the table header so it inherits original jQuery properties. Hide
  // the table to avoid a flash of the header clone upon page load.
  this.stickyTable = $('<table class="sticky-header"/>')
    .insertBefore(this.originalTable)
    .css({ position: 'fixed', top: '0px' });
  this.stickyHeader = this.originalHeader.clone(true)
    .hide()
    .appendTo(this.stickyTable);
  this.stickyHeaderCells = this.stickyHeader.find('> tr > th');

  this.originalTable.addClass('sticky-table');
  $(window)
    .bind('scroll.drupal-tableheader', $.proxy(this, 'eventhandlerRecalculateStickyHeader'))
    .bind('resize.drupal-tableheader', { calculateWidth: true }, $.proxy(this, 'eventhandlerRecalculateStickyHeader'))
    // Make sure the anchor being scrolled into view is not hidden beneath the
    // sticky table header. Adjust the scrollTop if it does.
    .bind('drupalDisplaceAnchor.drupal-tableheader', function () {
      window.scrollBy(0, -self.stickyTable.outerHeight());
    })
    // Make sure the element being focused is not hidden beneath the sticky
    // table header. Adjust the scrollTop if it does.
    .bind('drupalDisplaceFocus.drupal-tableheader', function (event) {
      if (self.stickyVisible && event.clientY < (self.stickyOffsetTop + self.stickyTable.outerHeight()) && event.$target.closest('sticky-header').length === 0) {
        window.scrollBy(0, -self.stickyTable.outerHeight());
      }
    })
    .triggerHandler('resize.drupal-tableheader');

  // We hid the header to avoid it showing up erroneously on page load;
  // we need to unhide it now so that it will show up when expected.
  this.stickyHeader.show();
};

/**
 * Event handler: recalculates position of the sticky table header.
 *
 * @param event
 *   Event being triggered.
 */
Drupal.tableHeader.prototype.eventhandlerRecalculateStickyHeader = function (event) {
  var self = this;
  var calculateWidth = event.data && event.data.calculateWidth;

  // Reset top position of sticky table headers to the current top offset.
  this.stickyOffsetTop = Drupal.settings.tableHeaderOffset ? eval(Drupal.settings.tableHeaderOffset + '()') : 0;
  this.stickyTable.css('top', this.stickyOffsetTop + 'px');

  // Save positioning data.
  var viewHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
  if (calculateWidth || this.viewHeight !== viewHeight) {
    this.viewHeight = viewHeight;
    this.vPosition = this.originalTable.offset().top - 4 - this.stickyOffsetTop;
    this.hPosition = this.originalTable.offset().left;
    this.vLength = this.originalTable[0].clientHeight - 100;
    calculateWidth = true;
  }

  // Track horizontal positioning relative to the viewport and set visibility.
  var hScroll = document.documentElement.scrollLeft || document.body.scrollLeft;
  var vOffset = (document.documentElement.scrollTop || document.body.scrollTop) - this.vPosition;
  this.stickyVisible = vOffset > 0 && vOffset < this.vLength;
  this.stickyTable.css({ left: (-hScroll + this.hPosition) + 'px', visibility: this.stickyVisible ? 'visible' : 'hidden' });

  // Only perform expensive calculations if the sticky header is actually
  // visible or when forced.
  if (this.stickyVisible && (calculateWidth || !this.widthCalculated)) {
    this.widthCalculated = true;
    // Resize header and its cell widths.
    this.stickyHeaderCells.each(function (index) {
      var cellWidth = self.originalHeaderCells.eq(index).css('width');
      // Exception for IE7.
      if (cellWidth == 'auto') {
        cellWidth = self.originalHeaderCells.get(index).clientWidth + 'px';
      }
      $(this).css('width', cellWidth);
    });
    this.stickyTable.css('width', this.originalTable.css('width'));
  }
};

})(jQuery);
;
(function($) {

var BUE = window.BUE = window.BUE || {preset: {}, templates: {}, instances: [], preprocess: {}, postprocess: {}};

// Get editor settings from Drupal.settings and process preset textareas.
BUE.behavior = function(context, settings) {
  var set = settings.BUE || null, tpls = BUE.templates, pset = BUE.preset;
  if (set) {
    $.each(set.templates, function (id, tpl) {
      tpls[id] = tpls[id] || $.extend({}, tpl);
    });
    $.extend(pset, set.preset);
    set.templates = {};
    set.preset = {};
  }
  $.each(pset, function (tid, tplid) {
    BUE.processTextarea($('#'+ tid, context).get(0), tplid);
  });
  // Fix enter key on textfields triggering button click.
  $('input:text', context).bind('keydown.bue', BUE.eFixEnter);
};

// Integrate editor template into textarea T
BUE.processTextarea = function (T, tplid) {
  if (!T || !BUE.templates[tplid] || !(T = $(T).filter('textarea')[0])) return false;
  // Check visibility on the element-level only.
  if (T.style.display == 'none' || T.style.visibility == 'hidden') return false;
  if (T.bue) return T.bue;
  var E = new BUE.instance(T, tplid);
  !BUE.active || BUE.active.textArea.disabled ? E.activate() : E.accesskeys(false);
  // Pre&post process.
  for (var i in BUE.preprocess) BUE.preprocess[i](E, $);
  for (var i in BUE.postprocess) BUE.postprocess[i](E, $);
  return E;
};

// Create an editor instance
BUE.instance = function (T, tplid) {
  var i = BUE.instances.length, E = T.bue = BUE.instances[i] = this;
  E.index = i;
  E.textArea = T;
  E.tplid = tplid;
  E.tpl = BUE.templates[tplid];
  E.bindex = null;
  E.safeToPreview = T.value.indexOf('<') == -1;
  E.UI = BUE.$html(BUE.theme(tplid).replace(/\%n/g, i)).insertBefore(T);
  E.buttons = $('.bue-button', E.UI).each(function(i, B) {
    var arr = B.id.split('-');
    $($.extend(B, {eindex: arr[1], bid: arr[3], bindex: i})).bind('click.bue', BUE.eButtonClick);
  }).get();
  $(T).bind('focus.bue', BUE.eTextareaFocus);
};

// Execute button's click event
BUE.buttonClick = function (eindex, bindex) { try {
  var E = BUE.instances[eindex].activate();
  var domB = E.buttons[bindex];
  var tplB = E.tpl.buttons[domB.bid];
  var content = tplB[1];
  E.bindex = bindex;
  E.dialog.close();
  if (tplB[4]) {
    tplB[4](E, $);
  }
  else if (content) {
    var arr = content.split('%TEXT%');
    if (arr.length == 2) E.tagSelection(arr[0], arr[1]);
    else E.replaceSelection(arr.length == 1 ? content : arr.join(E.getSelection()), 'end');
  }
  !(domB.pops || domB.stayClicked) && E.focus();
  } catch (e) {alert(e.name +': '+ e.message);}
  return false;
};

// Return html for editor templates.
BUE.theme = function (tplid) {
  var tpl = BUE.templates[tplid] || {html: ''}, html = '', sprite;
  if (typeof tpl.html == 'string') return tpl.html;
  // Load sprite
  if (sprite = tpl.sprite) {
    var surl = (new Image()).src = sprite.url, sunit = sprite.unit, sx1 = sprite.x1;
    $(document.body).append('<style type="text/css" media="all">.bue-'+ tplid +' .bue-sprite-button {background-image: url('+ surl +'); width: '+ sunit +'px; height: '+ sunit +'px;}</style>');
  }
  var access = $.browser.mozilla && 'Shift + Alt' || $.browser.msie && 'Alt', title, content, icon, key, func;
  // Create html for buttons. B(0-title, 1-content, 2-icon or caption, 3-accesskey) and 4-function for js buttons
  for (var B, isimg, src, type, btype, attr, i = 0, s = 0; B = tpl.buttons[i]; i++) {
    // Empty button.
    if (B.length == 0) {
      s++;
      continue;
    }
    title = B[0], content = B[1], icon = B[2], key = B[3], func = null;
    // Set button function
    if (content.substr(0, 3) == 'js:') {
      func = B[4] = new Function('E', '$', content.substr(3));
    }
    isimg = (/\.(png|gif|jpg)$/i).test(icon);
    // Theme button.
    if (title.substr(0, 4) == 'tpl:') {
      html += func ? (func(null, $) || '') : content;
      html += icon ? ('<span class="separator">'+ (isimg ? '<img src="'+ tpl.iconpath +'/'+ icon +'" />' : icon) +'</span>') : '';
      continue;
    }
    // Text button
    if (!isimg) {
      type = 'button', btype = 'text', attr = 'value="'+ icon +'"';
    }
    else {
      type = 'image', attr = 'alt="'+ icon +'"';
      // Sprite button
      if (sprite) {
        btype = 'sprite', attr += ' src="'+ sx1 +'" style="background-position: -'+ (s * sunit) +'px 0;"';
        s++;
      }
      // Image button
      else {
        btype = 'image', attr += ' src="'+ tpl.iconpath +'/'+ icon +'"';
      }
    }
    html += '<input type="'+ type +'" title="'+ title + (access && key ? ' ('+ access +' + '+ key +')' : '') +'" accesskey="'+ key +'" id="bue-%n-button-'+ i +'" class="bue-button bue-'+ btype +'-button editor-'+ btype +'-button" '+ attr +' tabindex="-1" />';
  }
  return tpl.html = '<div class="bue-ui bue-'+ tplid +' editor-container clearfix" id="bue-ui-%n">'+ html +'</div>';
};

// Cross browser selection handling. 0-1=All, 2=IE, 3=Opera
BUE.mode = (window.getSelection || document.getSelection) ? ($.browser.opera ? 3 : 1) : (document.selection && document.selection.createRange ? 2 : 0 );

// New line standardization. At least make them represented by a single char.
BUE.text = BUE.processText = BUE.mode < 2 ? function (s) {return s.toString()} : function (s) {return s.toString().replace(/\r\n/g, '\n')};

// Create selection in a textarea
BUE.selMake = BUE.mode == 2 ? function (T, start, end) {
  range = T.createTextRange();
  range.collapse();
  range.moveEnd('character', end);
  range.moveStart('character', start);
  range.select();
} :
BUE.mode == 3 ? function (T, start, end) {
  var text = BUE.text(T.value), i = text.substring(0, start).split('\n').length, j = text.substring(start, end).split('\n').length;
  T.setSelectionRange(start + i -1 , end + i + j - 2);
} :
function (T, start, end) {
  T.setSelectionRange(start, end);
};

// Return the selection coordinates in a textarea
BUE.selPos = BUE.mode == 2 ? function (T) {
  T.focus();
  var orange = document.selection.createRange(), range = orange.duplicate();
  range.moveToElementText(T);
  range.setEndPoint('EndToEnd', orange);
  var otext = orange.text, olen = otext.length, prelen = range.text.length - olen;
  var start = prelen - (T.value.substr(0, prelen).split('\r\n').length - 1);
  start && range.moveStart('character', start);
  for (; range.compareEndPoints('StartToStart', orange) < 0; start++) {
    range.moveStart('character', 1);
  }
  var end = start + olen - (otext.split('\r\n').length - 1);
  for (; range.compareEndPoints('EndToStart', orange) > 0; end++) {
    range.moveEnd('character', -1);
    if (range.text.length != olen) break;
  }
  return {start: start, end: end};
} :
BUE.mode == 3 ? function (T) {
  var start = T.selectionStart || 0, end = T.selectionEnd || 0, val = T.value;
  var i = val.substring(0, start).split('\r\n').length, j = val.substring(start, end).split('\r\n').length;
  return {start: start - i + 1, end: end - i - j + 2};
} :
function (T) {
  return {start: T.selectionStart || 0, end: T.selectionEnd || 0}
};

// Enter key fixer for text fields
BUE.eFixEnter = function(e) {
  e.keyCode == 13 && (BUE.enterKeyTime = new Date());
};

// Button click handler
BUE.eButtonClick = function(e) {
  return !(BUE.enterKeyTime && new Date() - BUE.enterKeyTime < 500) && BUE.buttonClick(this.eindex, this.bindex);
}

// Textarea focus handler
BUE.eTextareaFocus = function(e) {
  this.bue && !this.bue.dialog.esp && this.bue.activate();
}

// Html 2 jquery. Faster than $(html)
BUE.$html = function(s){
  return $(document.createElement('div')).html(s).children();
};

// Backward compatibility.
window.editor = window.editor || BUE;

// Initiate bueditor
$(document).ready(function () {
  var b = Drupal.behaviors.BUE = {};
  (b.attach = BUE.behavior)(document, Drupal.settings);
});

})(jQuery);


// Bueditor instance methods
(function(E) {

// Focus on editor textarea.
E.focus = function () {
  this.textArea.focus();
  return this;
};

// Return textarea content
E.getContent = function () {
  return BUE.text(this.textArea.value);
};

// Set textarea content
E.setContent = function (content) {
  var T = this.textArea, st = T.scrollTop;
  T.value = content;
  T.scrollTop = st;
  return this;
};

// Return selected text
E.getSelection = function () {
  var pos = this.posSelection();
  return this.getContent().substring(pos.start, pos.end);
};

// Replace selected text
E.replaceSelection = function (txt, cursor) {
  var E = this, pos = E.posSelection(), content = E.getContent(), txt = BUE.text(txt);
  var end = cursor == 'start' ? pos.start : pos.start+txt.length, start = cursor == 'end' ? end : pos.start;
  E.setContent(content.substr(0, pos.start) + txt + content.substr(pos.end));
  return E.makeSelection(start, end);
};

// Wrap selected text.
E.tagSelection = function (left, right, cursor) {
  var E = this, pos = E.posSelection(), content = E.getContent();
  var left = BUE.text(left), right = BUE.text(right), llen = left.length;
  var end = cursor == 'start' ? pos.start+llen : pos.end+llen, start = cursor == 'end' ? end : pos.start+llen;
  E.setContent(content.substr(0, pos.start) + left + content.substring(pos.start, pos.end) + right + content.substr(pos.end));
  return E.makeSelection(start, end);
};

// Make a new selection
E.makeSelection = function (start, end) {
  var E = this;
  if (end === undefined || end < start) end = start;
  BUE.selMake(E.textArea, start, end);
  E.dialog.esp && (E.dialog.esp = {start: start, end: end}) || E.focus();
  return E;
};

// Return selection coordinates.
E.posSelection = function () {
  return this.dialog.esp || BUE.selPos(this.textArea);
};

// Enable/disable editor buttons
E.buttonsDisabled = function (state, bindex) {
  for (var B, i=0; B = this.buttons[i]; i++) {
    B.disabled = i == bindex ? !state : state;
  }
  return this;
};

// Make active/custom button stay clicked
E.stayClicked = function (state, bindex) {
  var B = this.buttons[bindex === undefined ? this.bindex : bindex];
  B && jQuery(B)[state ? 'addClass' : 'removeClass']('stay-clicked') && (B.stayClicked = state || false);
  return this;
};

// Enable/disable button accesskeys
E.accesskeys = function (state) {
  for (var B, i=0; B = this.buttons[i]; i++) {
    B.accessKey = state ? this.tpl.buttons[B.bid][3] : '';
  }
  return this;
};

// Activate editor and make it BUE.active
E.activate = function() {
  var E = this, A = BUE.active || null;
  if (E == A) return E;
  A && A.accesskeys(false) && E.accesskeys(true);
  return BUE.active = E;
};

// Reserve dialog and quickPop
var pop = E.dialog = E.quickPop = BUE.dialog = BUE.quickPop = {};
pop.open = pop.close = function(){};

})(BUE.instance.prototype);;
(function ($) {

/**
 * Automatically display the guidelines of the selected text format.
 */
Drupal.behaviors.filterGuidelines = {
  attach: function (context) {
    $('.filter-guidelines', context).once('filter-guidelines')
      .find(':header').hide()
      .parents('.filter-wrapper').find('select.filter-list')
      .bind('change', function () {
        $(this).parents('.filter-wrapper')
          .find('.filter-guidelines-item').hide()
          .siblings('.filter-guidelines-' + this.value).show();
      })
      .change();
  }
};

})(jQuery);
;
(function ($) {

Drupal.behaviors.tableSelect = {
  attach: function (context, settings) {
    $('table:has(th.select-all)', context).once('table-select', Drupal.tableSelect);
  }
};

Drupal.tableSelect = function () {
  // Do not add a "Select all" checkbox if there are no rows with checkboxes in the table
  if ($('td input:checkbox', this).size() == 0) {
    return;
  }

  // Keep track of the table, which checkbox is checked and alias the settings.
  var table = this, checkboxes, lastChecked;
  var strings = { 'selectAll': Drupal.t('Select all rows in this table'), 'selectNone': Drupal.t('Deselect all rows in this table') };
  var updateSelectAll = function (state) {
    $('th.select-all input:checkbox', table).each(function () {
      $(this).attr('title', state ? strings.selectNone : strings.selectAll);
      this.checked = state;
    });
  };

  // Find all <th> with class select-all, and insert the check all checkbox.
  $('th.select-all', table).prepend($('<input type="checkbox" class="form-checkbox" />').attr('title', strings.selectAll)).click(function (event) {
    if ($(event.target).is('input:checkbox')) {
      // Loop through all checkboxes and set their state to the select all checkbox' state.
      checkboxes.each(function () {
        this.checked = event.target.checked;
        // Either add or remove the selected class based on the state of the check all checkbox.
        $(this).parents('tr:first')[ this.checked ? 'addClass' : 'removeClass' ]('selected');
      });
      // Update the title and the state of the check all box.
      updateSelectAll(event.target.checked);
    }
  });

  // For each of the checkboxes within the table.
  checkboxes = $('td input:checkbox', table).click(function (e) {
    // Either add or remove the selected class based on the state of the check all checkbox.
    $(this).parents('tr:first')[ this.checked ? 'addClass' : 'removeClass' ]('selected');

    // If this is a shift click, we need to highlight everything in the range.
    // Also make sure that we are actually checking checkboxes over a range and
    // that a checkbox has been checked or unchecked before.
    if (e.shiftKey && lastChecked && lastChecked != e.target) {
      // We use the checkbox's parent TR to do our range searching.
      Drupal.tableSelectRange($(e.target).parents('tr')[0], $(lastChecked).parents('tr')[0], e.target.checked);
    }

    // If all checkboxes are checked, make sure the select-all one is checked too, otherwise keep unchecked.
    updateSelectAll((checkboxes.length == $(checkboxes).filter(':checked').length));

    // Keep track of the last checked checkbox.
    lastChecked = e.target;
  });
};

Drupal.tableSelectRange = function (from, to, state) {
  // We determine the looping mode based on the the order of from and to.
  var mode = from.rowIndex > to.rowIndex ? 'previousSibling' : 'nextSibling';

  // Traverse through the sibling nodes.
  for (var i = from[mode]; i; i = i[mode]) {
    // Make sure that we're only dealing with elements.
    if (i.nodeType != 1) {
      continue;
    }

    // Either add or remove the selected class based on the state of the target checkbox.
    $(i)[ state ? 'addClass' : 'removeClass' ]('selected');
    $('input:checkbox', i).each(function () {
      this.checked = state;
    });

    if (to.nodeType) {
      // If we are at the end of the range, stop.
      if (i == to) {
        break;
      }
    }
    // A faster alternative to doing $(i).filter(to).length.
    else if ($.filter(to, [i]).r.length) {
      break;
    }
  }
};

})(jQuery);
;
(function($) {

//Faster alternative to resizable textareas.
//Make textareas full expand/shrink on focus/blur
Drupal.behaviors.textarea = {attach: function(context, settings) {
  setTimeout(function() {$('.form-textarea-wrapper.resizable', context).once('textarea', textArea)});
}};

//Faster alternative to sticky headers.
//Header creation is skipped on load and done once the user scrolls on a table.
//Fixes tableselect bug where the state of checkbox in the cloned header is not updated.
Drupal.behaviors.tableHeader = {attach: function(context, settings) {
  var tables =$('table.sticky-enabled:not(.sticky-table)', context).addClass('sticky-table').get();
  if (tables.length) {
    if (!bue.tables) {
      bue.tables = [];
      $(window).scroll(winScroll).resize(winResize);
    }
    bue.tables = bue.tables.concat(tables);
  }
}};

//process resizable textareas
var textArea = function(i, W) {
  var T = $(W).addClass('resizable-textarea').find('textarea');
  var grp = $(El('div')).addClass('grippie').mousedown(TDrag).insertAfter(T)[0];
  $(T).focus(TExpand).blur(TShrink).keydown(TKeyResize);
  grp.bueT = T;
};

//start resizing textarea
var TDrag = function(e) {
  var $T = $(this.bueT), $doc = $(document);
  var doDrag = function(e) {$T.height($T[0].bueH = Math.max(18, bue.Y + e.pageY));return false;}
  var noDrag = function(e) {$doc.unbind('mousemove', doDrag).unbind('mouseup', noDrag);$T.css('opacity', 1);}
  bue.Y = $T.css('opacity', 0.25).height() - e.pageY;
  $doc.mousemove(doDrag).mouseup(noDrag);
  return false;
};

//auto-resize the textarea to its scroll height while typing. triggers are: backspace, enter, space, del, V, X
var resizeKeys = {'8': 1, '13': 1, '32': 1, '46': 1, '86': 1, '88': 1};
var TKeyResize = function(e) {
  var T = this;
  setTimeout(function() {
    if (resizeKeys[e.keyCode]) {
      var sH = T.scrollHeight, $T = $(T), tH = $T.height();
      tH < sH && $T.height(sH + 5);
    }
  });
};

//resize the textarea to its scroll height
var TExpand = function(e) {
  var T = this, sH = T.scrollHeight, $T = $(T), tH = $T.height();
  T.bueH = tH;
  tH < sH && $T.height(sH + 5);
};

//resize the textarea to its original height
var TShrink = function(e) {
  var T = this, $T = $(T), oriH = T.bueH, tH = $T.height();
  if (tH <= oriH) return;
  var $w = $(window), sTop = $w.scrollTop();
  var diffH = $T.offset().top < sTop  ? $T.height() - oriH : 0;
  $T.height(oriH);
  $w.scrollTop(sTop - diffH);
};

//create (table header)
var createHeader = function(table) {
  var $fixed = table.$fixed = $(table.cloneNode(false));
  var $repo = table.$repo = $(El('table')).append(table.tHead.cloneNode(true));
  $repo.css({visibility: 'hidden', position: 'absolute', left: '-999em', top: '-999em'}).insertBefore(table);
  $fixed.addClass('sticky-header').css('position', 'fixed')[0].id += '-fixed';
  return $fixed.insertBefore(table);
};

//handle window scroll (table header)
var winScroll = function(e) {
  var $w = $(window), sX = $w.scrollLeft(), sY = $w.scrollTop();
  for (var table, i = 0; table = bue.tables[i]; i++) {
    tableScroll(table, sX, sY);
  }
};

//handle window resize (table header)
var winResize = function(e) {
  for (var table, i = 0; table = bue.tables[i]; i++) if (table.$fixed && table.$fixed[0].tHead) {
    table.$fixed.width($(table).width());
  }
};

//handle sticky head on scroll (table header)
var tHeadOffset = false;
var tableScroll = function(table, sX, sY) {
  var $table = $(table), pos = $table.offset();
  var minY = pos.top, maxY = minY + $table.height() - $(table.tHead).height() * 2, minX = pos.left;
  var action = minY < sY && sY < maxY;
  var $fixed = table.$fixed || false;
  if (!action && (!$fixed || !$fixed[0].tHead)) return;
  $fixed = $fixed || createHeader(table);//create when necessary
  var $repo = table.$repo;
  if (action) {
    if (tHeadOffset === false) {//calculate toolbar offset
      tHeadOffset = Drupal.settings.tableHeaderOffset ? eval(Drupal.settings.tableHeaderOffset + '()') : 0;
    }
    $fixed.css({visibility: 'visible', top: tHeadOffset, left: minX-sX});
    if (!$fixed[0].tHead) {//run once in action
      var head = table.tHead;
      $table.prepend($repo[0].tHead);
      $fixed.append(head).width($table.width());
    }
  }
  else {//run once out of action
    $fixed.css('visibility', 'hidden');
    var head = table.tHead;
    $table.prepend($fixed[0].tHead);
    $repo.append(head);
  }
};

//process initial text(icon) fields. Add selector-opener next to them.
var iconProc = function(i, inp) {
  var sop = bue.sop.cloneNode(false);
  sop._txt = inp;
  sop.onclick = sopClick;
  inp.parentNode.insertBefore(sop, inp);
  bue.IL[inp.value] && iconShow(inp.value, sop);
};

//click event for selector opener.
var sopClick = function(e) {
  var pos = $(activeSop = this).offset();
  $(bue.IS).css({left: pos.left-parseInt($(bue.IS).width()/2)+10, top: pos.top+20}).show();
  setTimeout(function(){$(document).click(doClick)});
  return false;
};

//document click to close selector
var doClick = function(e) {
  $(document).unbind('click', doClick);
  $(bue.IS).hide();
};

//select text option
var textClick = function() {
  var sop = activeSop;
  if (sop._ico && $(sop._txt).is(':hidden')) {
    $(sop._ico).hide();
    $(sop._txt).show().val('');
  }
  sop._txt.focus();
};

//replace textfield with icon
var iconShow = function(name, sop) {
  $(sop._txt).val(name).hide();
  var img = sop._ico;
  if (img) {
    img.src = iconUrl(name);
    img.alt = img.title = name;
    $(img).show();
  }
  else {
    img = sop._ico = iconCreate(name).cloneNode(false);
    sop.parentNode.appendChild(img);
  }
};

//select image option
var iconClick = function() {iconShow(this.title, activeSop)};

//return URL for an icon
var iconUrl = function(name) {return bue.IP + name};

//create icon image.
var iconCreate = function(name) {
  var img = bue.IL[name];
  if (!img) return false;
  if (img.nodeType) return img;
  img = bue.IL[name] = El('img');
  img.src = iconUrl(name);
  img.alt = img.title = name;
  return img;
};

//create icon selector table
var iconSelector = function() {
  var table = $html('<table id="icon-selector" class="selector-table" style="display: none"><tbody><tr><td title="'+ Drupal.t('Text button') +'"><input type="text" size="1" class="form-text" /></td></tr></tbody></table>')[0];
  var tbody = table.tBodies[0];
  var row = tbody.rows[0];
  row.cells[0].onclick = textClick;
  var i = 1;
  for (var name in bue.IL) {
    if (i == 6) {
      tbody.appendChild(row = El('tr'));
      i = 0;
    }
    row.appendChild(cell = El('td'));
    cell.title = name;
    cell.onclick = iconClick;
    cell.appendChild(iconCreate(name));
    i++;
  }
  //fill in last row
  for(; i < 6; i++) {
    row.appendChild(El('td'));
  }
  return $(table).appendTo(document.body)[0];
};

//create key selector table
var keySelector = function() {
  var table = $html('<table id="key-selector" class="selector-table" style="display: none"><tbody></tbody></table>')[0];
  var tbody = table.tBodies[0];
  var keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
  bue.keys = {};
  for (var row, key, i = 0; key = keys[i]; i++) {
    i%6 == 0 && tbody.appendChild(row = El('tr'));
    bue.keys[key] = $(El('td')).mousedown(keyClick).html(key).attr({title: key}).appendTo(row)[0];
  }
  return $(table).appendTo(document.body)[0];
};

//click on a key in key selector.
var keyClick = function() {
  var key = $(this).text();
  activeSop.value = key;
  keyUsed(key, true, activeSop);
};

//get&set current used state for a key
var keyUsed = function(key, state, inp) {
  var key = key.toString().toUpperCase();
  if (state === undefined) return bue.keys[key] && $(bue.keys[key]).is('.used');
  var F = state ? ['addClass', 'unbind'] : ['removeClass', 'bind'];
  var title = inp ? $(inp).parents('tr:first').find('input.input-title').val() : key;
  bue.keys[key] && $(bue.keys[key])[F[0]]('used')[F[1]]('mousedown', keyClick).attr({title: title || key});
};

//process key fields to update key states
var keyProc = function(i, inp) {
  keyUsed(inp.value, true, inp);
  $(inp).parents('tr:first').find('input.input-title').val();
  $(inp).focus(function() {
    var pos = $(activeSop = this).offset();
    keyUsed(this.value, false);
    $(bue.KS).css({left: pos.left-parseInt($(bue.KS).width()/2)+10, top: pos.top+20}).show();
  }).blur(function() {
    $(bue.KS).hide();
    keyUsed(this.value, true, this);
  });
};

//table drag adjustment. make value updating simpler and start from 0.
var tableDrag = function() {
  var tdrag = Drupal.tableDrag && Drupal.tableDrag['button-table'];
  tdrag && (tdrag.updateFields = function() {
    $('#button-table input.input-weight').each(function(i, field) {field.value = i});
  })();//sort initially to make new buttons sink.
};

//actions for selected buttons
var selAction = function() {
  var $chks = $('#button-table').find('input:checkbox');
  if ($chks.size()) {
    $('#edit-go').click(function() {
      var action = $('#edit-selaction').val();
      if (action && $chks.filter(':checked').size()) {
        return action != 'delete' || confirm(Drupal.t('Are you sure want to delete the selected buttons?'));
      }
      return false;
    });
    $('#edit-selaction').change(function() {
      $('#edit-copyto')[this.value == 'copyto' ? 'show' : 'hide']();
    }).change();
  }
  else {
    $('#sel-action-wrapper').css({display: 'none'});
  }
};

//alter editor textarea process in order to calculate the process time
var eTime = function() {
  var oldProc = BUE.processTextarea;
  BUE.processTextarea = function (T, tplid) {
    var t = new Date(), E = oldProc(T,  tplid), jstime = '' + (new Date() - t);
    E && T.id == 'edit-demo-value' && setTimeout(function() {
      var phptime = '' + Drupal.settings.BUE.demotime, pad = ['000', '00', '0'];
      T.value += '\n\nEditor load times (milliseconds): \n  -Server side (PHP)\t: '+ (pad[phptime.length] || '') + phptime +'\n  -Client side (JS)\t: '+ (pad[jstime.length] || '') + jstime;
    });
    return E;
  };
};

//initiate variables and process page elements
var init = function() {
  bue.IL = Drupal.settings.BUE.iconlist;
  bue.BP = Drupal.settings.basePath;
  bue.IP = bue.BP + Drupal.settings.BUE.iconpath +'/';
  bue.$div = $(El('div'));
  bue.sop = $html('<img class="icon-selector-opener" src="'+ bue.BP +'misc/menu-expanded.png" title="'+ Drupal.t('Select an icon') +'" />')[0];
  //sync safe modifications
  setTimeout(function() {
    bue.IS = iconSelector(); //create icon selector
    bue.KS = keySelector(); //create key selector
    $('input').filter('.input-icon').each(iconProc).end().filter('.input-key').each(keyProc);//process icons and keys
    //disable A, C, V, X key selection when ctrl shortcuts are on.
    window.BUE && window.BUE.preprocess.ctrl && $.each(['A', 'C', 'X', 'V'], function(i, key) {keyUsed(key, true)});
    selAction();//selected buttons actions
    tableDrag();//alter table drag
    //disable auto expand/shrink for demo
    $('#edit-demo-value').unbind('focus', TExpand).unbind('blur', TShrink).unbind('keydown', TKeyResize);
  });
};

//local container
var bue = {};
//create document element
var El = function(name) {return document.createElement(name)};
//html to jQuery
var $html = function(s){return bue.$div.html(s).children()};
//calculate editor instance creation time
window.BUE && eTime();
//initiate
$(document).ready(init);

})(jQuery);;
(function ($) {

Drupal.toolbar = Drupal.toolbar || {};

/**
 * Attach toggling behavior and notify the overlay of the toolbar.
 */
Drupal.behaviors.toolbar = {
  attach: function(context) {

    // Set the initial state of the toolbar.
    $('#toolbar', context).once('toolbar', Drupal.toolbar.init);

    // Toggling toolbar drawer.
    $('#toolbar a.toggle', context).once('toolbar-toggle').click(function(e) {
      Drupal.toolbar.toggle();
      // Allow resize event handlers to recalculate sizes/positions.
      $(window).triggerHandler('resize');
      return false;
    });
  }
};

/**
 * Retrieve last saved cookie settings and set up the initial toolbar state.
 */
Drupal.toolbar.init = function() {
  // Retrieve the collapsed status from a stored cookie.
  var collapsed = $.cookie('Drupal.toolbar.collapsed');

  // Expand or collapse the toolbar based on the cookie value.
  if (collapsed == 1) {
    Drupal.toolbar.collapse();
  }
  else {
    Drupal.toolbar.expand();
  }
};

/**
 * Collapse the toolbar.
 */
Drupal.toolbar.collapse = function() {
  var toggle_text = Drupal.t('Show shortcuts');
  $('#toolbar div.toolbar-drawer').addClass('collapsed');
  $('#toolbar a.toggle')
    .removeClass('toggle-active')
    .attr('title',  toggle_text)
    .html(toggle_text);
  $('body').removeClass('toolbar-drawer').css('paddingTop', Drupal.toolbar.height());
  $.cookie(
    'Drupal.toolbar.collapsed',
    1,
    {
      path: Drupal.settings.basePath,
      // The cookie should "never" expire.
      expires: 36500
    }
  );
};

/**
 * Expand the toolbar.
 */
Drupal.toolbar.expand = function() {
  var toggle_text = Drupal.t('Hide shortcuts');
  $('#toolbar div.toolbar-drawer').removeClass('collapsed');
  $('#toolbar a.toggle')
    .addClass('toggle-active')
    .attr('title',  toggle_text)
    .html(toggle_text);
  $('body').addClass('toolbar-drawer').css('paddingTop', Drupal.toolbar.height());
  $.cookie(
    'Drupal.toolbar.collapsed',
    0,
    {
      path: Drupal.settings.basePath,
      // The cookie should "never" expire.
      expires: 36500
    }
  );
};

/**
 * Toggle the toolbar.
 */
Drupal.toolbar.toggle = function() {
  if ($('#toolbar div.toolbar-drawer').hasClass('collapsed')) {
    Drupal.toolbar.expand();
  }
  else {
    Drupal.toolbar.collapse();
  }
};

Drupal.toolbar.height = function() {
  var height = $('#toolbar').outerHeight();
  // In IE, Shadow filter adds some extra height, so we need to remove it from
  // the returned height.
  if ($('#toolbar').css('filter').match(/DXImageTransform\.Microsoft\.Shadow/)) {
    height -= $('#toolbar').get(0).filters.item("DXImageTransform.Microsoft.Shadow").strength;
  }
  return height;
};

})(jQuery);
;

//Introduces editor popups: E.dialog & E.quickPop
//Requires: none
(function(E, $) {

BUE.popups = BUE.popups || {};

//default template for editor popups or dialogs. Use table wrapper against various positioning bugs in IE.
BUE.popHtml = '<table class="bue-popup" style="display: none;"><tbody class="bue-zero"><tr class="bue-zero"><td class="bue-zero"><div class="bue-popup-head clearfix"><div class="bue-popup-title"></div><div class="bue-popup-close">x</div></div><div class="bue-popup-body"><div class="bue-popup-content clearfix"></div></div></td></tr></tbody></table>';

//open popup.
BUE.openPopup = function (id, title, content, opt) {
  return BUE.createPopup(id).open(title, content, opt);
};

//create popup
BUE.createPopup = function (id, title, content) {
  if (BUE.popups[id]) {
    return BUE.popups[id];
  }
  var $P = BUE.$html(BUE.popHtml).appendTo('body').attr('id', id);
  var $title = $P.find('.bue-popup-title').html(title || '');
  var $content = $P.find('.bue-popup-content').html(content || '');
  var P = BUE.popups[id] = $P[0];
  //open
  P.open = function (title, content, opt) {
    if (title !== undefined && title !== null) {
      $title.html(title);
    }
    if (content !== undefined && content !== null) {
      $content.html(content);
    }
    var E = P.bue = BUE.active, B = E.buttons[E.bindex||0];
    opt = typeof opt == 'string' ? {effect: opt} : opt;
    opt = $.extend({effect: 'show', speed: 'normal', callback: P.onopen}, opt);
    opt.onopen = opt.onopen || opt.callback;
    //calculate popup offset
    if (!opt.offset && B) {
      var pos = $(B).offset(), w = $P.width(), left = Math.max(15, pos.left - w/2 + 15);
      opt.offset = {
        left: left - Math.max(0, left + w - $(window).width() + 15),
        top: pos.top + 15
      };
      B.pops = true;
    }
    $P.css(opt.offset);
    //display popup
    if (opt.effect == 'show') {
      $P.show();
      opt.onopen && opt.onopen.call(P);
    }
    else {
      $P[opt.effect](opt.speed, opt.onopen);
    }
    P.onclose = opt.onclose || false;
    return P;
  };
  //close
  P.close = function(effect) {
    $P.stop(true, true)[effect || 'hide']();
    P.onclose && P.onclose.call(P);
    return P;
  };
  //close the pop, focus on the editor
  P.closenfocus = function() {
    P.close().bue.focus();
    return P;
  };
  //focus on the first link or form input if any exists in the pop.
  P.onopen = function() {
    if ($P.css('display') != 'none') {
      var $form = $P.focus().find('form');
      if ($form.size()) {
        $($form[0].elements[0]).focus();
      }
      else {
        $P.find('a:first').focus();
      }
    }
    return P;
  }
  //add tabindex. make focusable
  $P.attr('tabindex', 0);
  //close-button
  $P.find('.bue-popup-close').click(P.closenfocus);
  //close on ESC
  $P.keydown(function(e) {
    if (e.keyCode == 27) {
      P.closenfocus();
      return false;
    }
  });
  //make draggable
  $P.find('.bue-popup-head').mousedown(function (e) {
    var pos = {X: parseInt($P.css('left')) - e.pageX, Y: parseInt($P.css('top')) - e.pageY};
    var drag =  function(e) {$P.css({left: pos.X + e.pageX, top: pos.Y + e.pageY});return false;};
    var undrag = function(e) {$(document).unbind('mousemove', drag).unbind('mouseup', undrag)};
    $(document).mousemove(drag).mouseup(undrag);
    return false;
  });
  return P;
};

//initialize editor dialog & quickPop.
BUE.preprocess = $.extend({popup: function(Ed, $) {
  //run once
  if (Ed.index) return;
  //ceate the dialog.
  var D = E.dialog = BUE.dialog = BUE.createPopup('bue-dialog');
  var foc  = function() {this.blur()};
  var Do = D.open, Dc = D.close;
  //open
  D.open = function(title, content, opt) {
    D.esp && D.close();
    var E = BUE.active;
    E.buttonsDisabled(true).stayClicked(true);
    D.esp = E.posSelection();
    $(E.textArea).bind('focus.bue', foc);
    return Do(title, content, opt);
  };
  //close
  D.close = function(effect) {
    if (!D.esp) return D;
    var E = D.bue;
    $(E.textArea).unbind('focus.bue', foc);
    E.buttonsDisabled(false).stayClicked(false);
    E == BUE.active && E.makeSelection(D.esp.start, D.esp.end);
    D.esp = null;
    return Dc(effect);
  };

  //Create quick pop
  var Q = E.quickPop = BUE.quickPop = BUE.createPopup('bue-quick-pop');
  var Qo = Q.open, Qc = Q.close, $Q = $(Q);
  //open
  Q.open = function(content, opt) {
    $(document).mouseup(Q.close);
    return Qo(null, content, opt);
  };
  //close
  Q.close = function() {
    $(document).unbind('mouseup', Q.close);
    return Qc();
  };
  //navigate(UP-DOWN) & trigger(ENTER) links
  $Q.keydown(function (e) {
    switch (e.keyCode) {
      case 13:
        setTimeout(Q.closenfocus);//settimeout to allow click event trigger.
        break;
      case 38:case 40:
        var $a = $Q.find('a'), i = $a.index(document.activeElement);
        $a.eq(i + e.keyCode - 39).focus();
        return false;
    }
  });
  //no title in quick-pop
  $Q.find('.bue-popup-head').css({display: 'none'});//hide() is too slow.
}}, BUE.preprocess);

})(BUE.instance.prototype, jQuery);;

//Html creating and parsing methods.
//Requires: none
(function(E, $) {

//html for a given tag. attributes having value=null are not printed.
BUE.html = function(tag, ihtml, attr) {
  var A = attr || {}, I = ihtml || '';
  var H = '<'+ tag;
  for (var i in A) {
    H += A[i] == null ? '' : ' '+ i +'="'+ A[i] +'"';
  }
  H += Nc(tag) ? (' />'+ I) : ('>'+ I +'</'+ tag +'>');
  return tag ? H : I;
};

//html for a given object.
BUE.objHtml = function(obj) {
  return obj && obj.tag ? Html(obj.tag, obj.html, obj.attributes) : '';
};

//form input html.
BUE.input = function(t, n, v, a) {
  return Html('input', '', $.extend({'type': t, 'name': n, 'value': v||null}, a));
};

//selectbox html. opt has property:value pairs.
BUE.selectbox = function(n, v, opt, attr) {
  var opt = opt||{}, H = '';
  for (var i in opt) {
    H += Html('option', opt[i], {'value': i, 'selected': i == v ? 'selected' : null});
  }
  return Html('select', H, $.extend({}, attr, {'name': n}));
};

//table html
BUE.table = function(rows, attr) {
  for (var R, H = '', i = 0; R = rows[i]; i++) {
    H += R['data'] === undefined ? BUE.trow(R) : BUE.trow(R['data'], R['attr']);
  }
  return Html('table', H, attr);
};
BUE.trow = function(cells, attr) {
  for (var C, H = '', i = 0; C = cells[i]; i++) {
    H += C['data'] === undefined ? Html('td', C) : Html('td', C['data'], C['attr']);
  }
  return Html('tr', H, attr);
};

//Escape regular expression specific characters in a string
BUE.regesc = function (s) {
  return s.replace(/([\\\^\$\*\+\?\.\(\)\[\]\{\}\|\:])/g, '\\$1');
};

//Check if a string is a non closing html tag.
BUE.nctag = function (s) {
  return !s || /^(img|input|hr|br|embed|param)$/.test(s);
};

//Parse the string as html. If match an html element return properties, otherwise return null.
BUE.parseHtml = function(s, tag) {
  var r = new RegExp('^<('+ (tag || '[a-z][a-z0-9]*') +')([^>]*)>($|((?:.|[\r\n])*)</\\1>$)');
  if (!(match = s.match(r)) || (!match[3] && !Nc(match[1]))) {
    return null;
  }
  var tag = match[1], arr = [], attr = {}, match;
  if ((arr = match[2].split('"')).length > 1) {
    for (var i = 0; arr[i+1] !== undefined; i += 2) {
      attr[arr[i].replace(/\s|\=/g, '')] = arr[i+1];
    }
  }
  return {tag: tag, attributes: attr, html: match[4]};
};

//Insert a parsed object into textarea by extending/replacing/tagging the current selection.
E.insertObj = function(obj, opt) {
  if (!obj || !obj.tag) {
    return this;
  }
  var E = this, tag = obj.tag, opt = $.extend({cursor: null, extend: true, toggle: false}, opt);
  var sametag, sel = E.getSelection(), selobj = sel && opt.extend && BUE.parseHtml(sel);
  //selection and new obj are of the same type
  if (sametag = selobj && selobj.tag == tag) {
    //toggle selected tag and exit
    if (opt.toggle) return E.replaceSelection(selobj.html, opt.cursor);
    //create a new object to combine properties of selection and the new obj.
    var obj = {
      tag: tag,
      html: typeof obj.html != 'string' || obj.html == sel ? selobj.html : obj.html,
      attributes: $.extend(selobj.attributes, obj.attributes)
    };
  }
  //replace selection
  if (sametag || Nc(tag) || obj.html) {
    return E.replaceSelection(BUE.objHtml(obj), opt.cursor);
  }
  //tag selection
  var html = Html(tag, '', obj.attributes);
  return E.tagSelection(html.substr(0, html.length - tag.length - 3), '</'+ tag +'>', opt.cursor);
};

//shortcuts
var Html = BUE.html;
var Nc = BUE.nctag;

})(BUE.instance.prototype, jQuery);

//backward compatibility.
eDefHTML = BUE.html;
eDefInput = BUE.input;
eDefSelectBox = BUE.selectbox;
eDefTable = BUE.table;
eDefRow = BUE.trow;
eDefNoEnd = BUE.nctag;
eDefRegEsc = BUE.regesc;
eDefParseTag = BUE.parseHtml;
eDefInputText = function(n, v, s) {return BUE.input('text', n, v, {'size': s||null})};
eDefInputSubmit = function(n, v) {return BUE.input('submit', n, v)};;

//Introduces E.prv(), E.prvAjax()
//Requires: none
(function(E, $) {

//Show/hide content preview.
E.prv = function(safecheck) {
  var E = this;
  if (E.prvOn) {
    return E.prvHide();
  }
  var safecheck = safecheck === undefined ? true : safecheck;
  var content = E.getContent();
  if (safecheck && !(E.safeToPreview = E.safeToPreview || content.indexOf('<') == -1)) {
    content = '<div class="warning">' + Drupal.t('The preview is disabled due to previously inserted HTML code in the content. This aims to protect you from any potentially harmful code inserted by other editors or users. If you own the content, just preview an empty text to re-enable the preview.') + '</div>';
  }
  return E.prvShow(BUE.autop(content));
};

//show preview with html inside.
E.prvShow = function(html, wrap) {
  var E = this;
  var $T = $(E.textArea);
  var $P = $(E.preview = E.preview || BUE.$html('<div class="preview bue-preview" style="display:none; overflow:auto"></div>').insertBefore($T)[0]);
  if (wrap === undefined || wrap) {
    html = '<div class="'+ (E.textArea.name == 'comment' ? 'comment' : 'node') +'"><div class="content">' + html + '</div></div>';
  }
  if (E.prvOn) {
    $P.html(html);
    return E;
  }
  E.prvPos = E.posSelection();
  $P.show().height($T.height()).width($T.width()).html(html);
  $T.height(1);
  E.buttonsDisabled(true, E.bindex).stayClicked(true);
  E.prvOn = true;
  return E;
};

//Hide preview.
E.prvHide = function() {
  var E = this;
  if (E.prvOn) {
    var $P = $(E.preview);
    $(E.textArea).height($P.height());
    $P.hide();
    E.buttonsDisabled(false).stayClicked(false);
    E.prvOn = false;
    E.prvPos && (E.makeSelection(E.prvPos.start, E.prvPos.end).prvPos = null);
  }
  return E;
};

//Ajax preview. Requires ajax_markup module.
 E.prvAjax = function(callback) {
  var E = this, $xM;
  if (E.prvOn) {
    return E.prvHide();
  }
  if (!($xM = $.ajaxMarkup)) {
    return E.prvShow(Drupal.t('Preview requires <a href="http://drupal.org/project/ajax_markup">Ajax markup</a> module with proper permissions set.'));
  }
  E.prvShow('<div class="bue-prv-loading">' + Drupal.t('Loading...') + '</div>');
  $xM(E.getContent(), $xM.getFormat(E.textArea), function(output, status, request) {
    E.prvOn && E.prvShow(status ? output : output.replace(/\n/g, '<br />')) && (callback || Drupal.attachBehaviors)(E.preview);
  });
  return E;
};

//Convert new line characters to html breaks or paragraphs. Ported from http://photomatt.net/scripts/autop
BUE.autop = function (s) {
  if (s == '' || !(/\n|\r/).test(s)) {
    return s;
  }
  var  X = function(x, a, b) {return x.replace(new RegExp(a, 'g'), b)};
  var  R = function(a, b) {return s = X(s, a, b)};
	var blocks = '(table|thead|tfoot|caption|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|select|form|blockquote|address|math|style|script|object|input|param|p|h[1-6])';
	s += '\n';
  R('<br />\\s*<br />', '\n\n');
  R('(<' + blocks + '[^>]*>)', '\n$1');
  R('(</' + blocks + '>)', '$1\n\n');
  R('\r\n|\r', '\n'); // cross-platform newlines
  R('\n\n+', '\n\n');// take care of duplicates
  R('\n?((.|\n)+?)\n\\s*\n', '<p>$1</p>\n');// make paragraphs
  R('\n?((.|\n)+?)$', '<p>$1</p>\n');//including one at the end
  R('<p>\\s*?</p>', '');// under certain strange conditions it could create a P of entirely whitespace
  R('<p>(<div[^>]*>\\s*)', '$1<p>');
  R('<p>([^<]+)\\s*?(</(div|address|form)[^>]*>)', '<p>$1</p>$2');
  R('<p>\\s*(</?' + blocks + '[^>]*>)\\s*</p>', '$1');
  R('<p>(<li.+?)</p>', '$1');// problem with nested lists
  R('<p><blockquote([^>]*)>', '<blockquote$1><p>');
  R('</blockquote></p>', '</p></blockquote>');
  R('<p>\\s*(</?' + blocks + '[^>]*>)', '$1');
  R('(</?' + blocks + '[^>]*>)\\s*</p>', '$1');
  R('<(script|style)(.|\n)*?</\\1>', function(m0) {return X(m0, '\n', '<PNL>')});
  R('(<br />)?\\s*\n', '<br />\n');
  R('<PNL>', '\n');
  R('(</?' + blocks + '[^>]*>)\\s*<br />', '$1');
  R('<br />(\\s*</?(p|li|div|dl|dd|dt|th|pre|td|ul|ol)[^>]*>)', '$1');
  if (s.indexOf('<pre') != -1) {
    R('(<pre(.|\n)*?>)((.|\n)*?)</pre>', function(m0, m1, m2, m3) {
      return X(m1, '\\\\([\'\"\\\\])', '$1') + X(X(X(m3, '<p>', '\n'), '</p>|<br />', ''), '\\\\([\'\"\\\\])', '$1') + '</pre>';
    });
  }
  return R('\n</p>$', '</p>');
};

})(BUE.instance.prototype, jQuery);

//backward compatibility
eDefAutoP = BUE.autop;
eDefPreview = function() {BUE.active.prv()};
eDefPreviewShow = function(E, s, w) {E.prvShow(s, w)};
eDefPreviewHide = function(E) {E.prvHide()};
eDefAjaxPreview = function() {BUE.active.prvAjax()};;

//IMCE integration. Introduces E.imce=BUE.imce
//Requires: bue.popup.js
(function(E, $) {

//create IMCE object shared by all editor instances.
var I = E.imce = BUE.imce = {};
//set IMCE URL on document load
$(function() {I.url = Drupal.settings.BUE.imceURL || ''});

//IMCE button html to be used in forms. Target field's name is required.
I.button = function(fname, text) {
  return I.url ? '<input type="button" id="bue-imce-button" name="bue_imce_button" class="form-submit" value="'+ (text || Drupal.t('Browse')) +'" onclick="BUE.imce.open(this.form.elements[\''+ fname +'\'])">' : '';
};

//open IMCE with user specified options.
I.open = function(opt) {
  //require URL set.
  if (!I.url) {
    return;
  }
  //reset previous parameters.
  I.ready = I.sendto = function(){}, I.target = null;
  //copy new parameters.
  $.extend(I, opt.focus ? {target: opt, ready: I.readyDefault, sendto: I.sendtoDefault} : opt);
  //Show popup and execute ready method if IMCE was loaded before.
  if (I.pop) {
    I.setPos();
    I.ready(I.win, I.pop);
  }
  //Load IMCE once and for all. Run window.bueImceLoad which then runs the ready method.
  else {
    var url = I.url + (I.url.indexOf('?') < 0 ? '?' : '&') + 'app=bue|imceload@bueImceLoad|';
    I.pop = BUE.createPopup('bue-imce-pop', Drupal.t('File Browser'), '<iframe src="'+ url +'" frameborder="0"></iframe>');
    I.setPos();
  }
};

//centre the IMCE popup inside the parent window
I.setPos = function() {
  var $p = $(I.pop), $win = $(window), winH = $.browser.opera ? window.innerHeight : $win.height();
  I.pop.open(null, null, {offset: {
    left: Math.max(0, ($win.width() - $p.width())/2),
    top: $win.scrollTop() + Math.max(0, (winH - $p.height())/2)
  }});
};

//Static sendto operation which executes dynamically set I.sendto()
I.finish = function(file, win) {
  I.sendto(file, win, I.pop);
};

//Predefined sendto operation. Process the sent file & close IMCE
I.sendtoDefault = function(file, win, pop) {
  var target = I.target, el = target.form.elements, val = {'alt': file.name, 'width': file.width, 'height': file.height};
  target.value = file.url;
  for (var i in val) {
    if (el['attr_'+i]) el['attr_'+i].value = val[i];
  }
  pop.close();
  target.focus();
};

//Predefined ready method. Highlight target url and add ESC(close) shortcut to file list.
I.readyDefault = function(win, pop) {
  var imce = win.imce, path = I.target && I.target.value;
  //highlight the target path in imce file list
  path && imce.highlight(path.substr(path.lastIndexOf('/')+1));
  //add ESC(close) shortcut for the list and focus on it initially.
  if (imce.fileKeys && !imce.fileKeys.k27) {
    imce.fileKeys.k27 = function(e) {
      pop.closenfocus();
      I.target && I.target.focus();
    };
  }
  !$.browser.opera && !$.browser.safari && $(imce.FLW).focus();
};

//IMCE onload function. Runs after first load of IMCE.
window.bueImceLoad = function(win) {
  (I.win = win).imce.setSendTo(Drupal.t('Send to editor'), I.finish);
  I.ready(win, I.pop);
  // Fix opera and webkit focus scrolling.
  if (($.browser.opera || $.browser.safari) && $(I.pop).is(':visible')) {
    $(I.win.imce.FLW).one('focus', function() {I.pop.close(); I.setPos();});
  }
};

})(BUE.instance.prototype, jQuery);

//backward compatibility
eDefBrowseButton = function(l, f, t) {return BUE.imce.button(f, t)};
;

//Miscellaneous methods used in default editor: E.wrapLines(), E.toggleTag(), E.help(), E.tagChooser(), E.tagDialog()
//Requires: bue.popup.js, bue.markup.js
(function(E, $) {

//Wraps selected lines with b1 & b2 and then wrap the result with a1 & a2. Also restores a wrapped selection.
E.wrapLines = function(a1, b1, b2, a2) {
  var E = this, str = E.getSelection().replace(/\r\n|\r/g, '\n'), Esc = BUE.regesc;
  if (!str) {
    return E.tagSelection(a1 + b1, b2 + a2);
  }
  var M, R = new RegExp('^' + Esc(a1 + b1) + '((.|\n)*)' + Esc(b2 + a2) + '$');
  if (M = str.match(R)) {
    R = new RegExp(Esc(b2) + '\n' + Esc(b1), 'g');
    return E.replaceSelection(M[1].replace(R, '\n'));
  }
  return E.replaceSelection(a1 + b1 + str.replace(/\n/g, b2 + '\n' + b1) + b2 + a2);
};

//Tag toggling. Add/remove tag after parsing the selection.
E.toggleTag = function(tag, attributes, cursor) {
  var E = this, obj = {tag: tag, html: E.getSelection(), attributes: attributes};
  return E.insertObj(obj, {cursor: cursor, toggle: true});
};

//Display help text(button title) of each button.
E.help = function(effect) {
  var E = this;
  if (!E.helpHTML) {
    for (var B, rows = [], i = 0; B = E.buttons[i]; i++) {
      rows[i] = [BUE.input(B.type, null, B.value || null, {'class': B.className, src: B.src || null, style: $(B).attr('style')}), B.title];
    }
    E.helpHTML = BUE.table(rows, {id: 'bue-help', 'class': 'bue-'+ E.tplid});
  }
  E.quickPop.open(E.helpHTML, effect);
  return E;
};

//create clickable tag options that insert corresponding tags into the editor.[[tag, title, attributes],[...],...]
E.tagChooser = function(tags, opt) {
  var E = this, opt = $.extend({wrapEach: 'li', wrapAll: 'ul', applyTag: true, effect: 'slideDown'}, opt);
  var wa = BUE.html(opt.wrapAll || 'div', '', {'class': 'tag-chooser'}), $wa = $html(wa);
  var we = BUE.html(opt.wrapEach, '', {'class': 'choice'});
  var lnk = BUE.html('a', '', {href: '#', 'class': 'choice-link'});
  $.each(tags, function(i, inf) {
    var obj = {tag: inf[0], html: inf[1], attributes: inf[2]};
    $html(lnk).html(opt.applyTag ? BUE.objHtml(obj) : obj.html).click(function() {
      E.insertObj($.extend(obj, {html: null}));
      return false;
    }).appendTo($wa)[we ? 'wrap' : 'end'](we);
  });
  E.quickPop.open($wa, opt.effect);
  return E;
};

//open a dialog for a tag to get user input for the given attributes(fields).
E.tagDialog = function(tag, fields, opt) {
  var E = this, sel = E.getSelection(), obj = BUE.parseHtml(sel, tag) || {'attributes': {}};
  for (var field, hidden = '', rows = [], i = 0, n = 0; field = fields[i]; i++, n++) {
    field = fproc(field, obj, sel);
    if (field.type == 'hidden') {
      hidden += fhtml(field);
      n--;
      continue;
    }
    rows[n] = [field.title, fhtml(field)];
    while (field.getnext && (field = fields[++i])) {
      rows[n][1] += fhtml(fproc(field, obj, sel));
    }
  }
  var dopt = $.extend({title: Drupal.t('Tag editor - @tag', {'@tag': tag.toUpperCase()}), stitle: Drupal.t('OK'), validate: false, submit: function(a, b) {return E.tgdSubmit(a, b)}, effect: 'show'}, opt);
  var table = BUE.table(rows, {'class': 'bue-tgd-table'});
  var sbm = BUE.html('div', BUE.input('submit', 'bue_tgd_submit', dopt.stitle, {'class': 'form-submit'}));
  var $form = $html(BUE.html('form', table + sbm + hidden, {name: 'bue_tgd_form', id: 'bue-tgd-form'}));
  E.dialog.open(dopt.title, $form, opt);
  $form.submit(function(){return fsubmit(tag, this, dopt, E)});
  return E;
};

//default submit handler for tag form
E.tgdSubmit = function(tag, form) {
  var E = this, obj = {tag: tag, html: null, attributes: {}};
  for (var name, el, i = 0; el = form.elements[i]; i++) {
    if (el.name.substr(0, 5) == 'attr_') {
      name = el.name.substr(5);
      if (name == 'html') obj.html = el.value;
      else obj.attributes[name] = el.value.replace(/\x22/g, '&quot;').replace(/>/g, '&gt;').replace(/</g, '&lt;') || null;
    }
  }
  return E.insertObj(obj);
};

//helpers
var $html = BUE.$html;

//create field html
var fhtml = function (f) {
  var h = f.prefix || '';
  switch (f.type) {
    case 'select': h += BUE.selectbox(f.fname, f.value, f.options || {}, f.attributes); break;
    case 'textarea': h += BUE.html('textarea', '\n' + f.value, f.attributes); break;
    default: h += BUE.input(f.type, f.fname, f.value, f.attributes); break;
  }
  return h + (f.suffix || '');
};

//process field
var fproc = function(f, obj, sel) {
  f = typeof(f) == 'string' ? {'name': f} : f;
  if (f.name == 'html') {
    f.value =  typeof obj.html == 'string' ? obj.html : (sel || f.value || '');
  }
  f.value = Drupal.checkPlain(typeof obj.attributes[f.name] == 'string' ? obj.attributes[f.name] : (f.value || ''));
  f.title  = typeof f.title == 'string' ? f.title : f.name.substr(0, 1).toUpperCase() + f.name.substr(1);
  f.fname = 'attr_' + f.name;
  f.type = f.value.indexOf('\n') > -1 ? 'textarea' : (f.type || 'text');
  f.attributes = $.extend({name: f.fname, id: f.fname, 'class': ''}, f.attributes);
  f.attributes['class'] += ' form-' + f.type + (f.required ? ' required' : '');
  return f;
};

//tag dialog form submit
var fsubmit = function(tag, form, opt, E) {
  //check required fields.
  for (var el, i = 0; el = form.elements[i]; i++) if ($(el).is('.required') && !el.value) {
    return BUE.noticeRequired(el);
  }
  //custom validate
  var V = opt.validate;
  if (V) try {if (!V(tag, form, opt, E)) return false} catch(e) {alert(e.name +': '+ e.message)};
  E.dialog.close();
  //custom submit
  var S = opt.submit;
  S = typeof S == 'string' ? window[S] : S;
  if (S) try {S(tag, form, opt, E)} catch(e) {alert(e.name +': '+ e.message)};
  return false;
};

//Notice about the required field. Useful in form validation.
BUE.noticeRequired = function(field) {
  $(field).fadeOut('fast').fadeIn('fast', function(){$(this).focus()});
  return false;
};

})(BUE.instance.prototype, jQuery);

//backward compatibility.
eDefSelProcessLines = eDefTagLines = function (a, b, c, d) {BUE.active.wrapLines(a, b, c, d)};
eDefTagger = function(a, b, c) {BUE.active.toggleTag(a, b, c)};
eDefHelp = function(fx) {BUE.active.help(fx)};
eDefTagDialog = function(a, b, c, d, e, f) {BUE.active.tagDialog(a, b, {title: c, stitle: d, submit: e, effect: f})};
eDefTagInsert = function(a, b) {BUE.active.tgdSubmit(a, b)};
eDefTagChooser = function(a, b, c, d, e) {BUE.active.tagChooser(a, {applyTag: b, wrapEach: c, wrapAll: d, effect: e})};;

//Autocomplete user defined phrases as they are typed in the editor.
//Requires: none
(function(E, $) {

//tag completer for html & bbcode
BUE.ACTag = function(E, prefix) {
  var cursor = E.posSelection().start, content = E.getContent();
  if (content.substr(cursor - 1, 1) == '/') return;
  var mate = ({'>': '<', ']': '['})[prefix];
  var i = content.substr(0, cursor).lastIndexOf(mate);
  if (i < 0) return;
  var re = new RegExp('^([a-z][a-z0-9]*)[^\\'+ prefix +']*$');
  var match = content.substring(i + 1, cursor).match(re);
  return match ? mate +'/'+ match[1] + prefix : null;
};

//set initial AC pairs
BUE.preprocess.autocomplete = function(E, $) {
  //add tag AC
  E.ACAdd({'<!--': '-->', '<?php': '?>', '>': BUE.ACTag, ']': BUE.ACTag});

  //register keypress
  $(E.textArea).bind('keypress.bue', function(e) {
    var code = e.charCode === undefined ? e.keyCode : e.charCode;
    //disable keycodes that have multi-meaning in opera. 39: hypen-right, 40: parenthesis-down.
    //extend 37:percentage-left, 38:ampersand-up, 33:exclamation-pageup, 34:double quote-pagedown...
    if ($.browser.opera && /^(37|38|39|40)$/.test(code+'')) return;
    var handler, suffix, chr = String.fromCharCode(code), prefix = chr;
    if (!(handler = E.AC[chr])) return;
    if (!handler.lookback) {
      suffix = handler;
    }
    else {
      var pos = E.posSelection(), content = E.getContent();
      for (var lb in handler.lookback) {
        if (content.substring(pos.start - lb.length, pos.start) == lb) {
          prefix = lb + prefix;
          suffix = handler.lookback[lb];
          break;
        }
      }
      if (suffix === undefined && handler.ins) {
        suffix = handler.ins
      }
    }
    if ($.isFunction(suffix)) {
      suffix = suffix(E, prefix);
    }
    if (suffix === false) return false;//prevent default
    typeof suffix == 'string' && E.replaceSelection(suffix, 'start');
  });

};

//Add AC pairs at runtime
E.ACAdd = function(prefix, suffix) {
  var E = this;
  if (typeof prefix == 'object') {
    $.each(prefix, function(a, b){E.ACAdd(a, b)});
    return E;
  }
  E.AC = E.AC || {};
  var len = prefix.length;
  if (len < 2) {
    len && (E.AC[prefix] = suffix);
    return E;
  }
  var trigger = prefix.charAt(len - 1), lookfor = prefix.substr(0, len - 1), options = E.AC[trigger];
  if (typeof options != 'object') {
    options = E.AC[trigger] = {lookback: {}, ins: options || false};
  }
  options.lookback[lookfor] = suffix;
  delete E.AC[prefix];
  return E;
};

//Remove an AC pair at runtime
E.ACRemove = function(prefix) {
  var E = this;
  var trigger = prefix.charAt(len-1);
  if (E.AC && E.AC[trigger]) {
    if (typeof E.AC[trigger] == 'object') {
      delete E.AC[trigger].lookback[prefix.substr(0, len-1)];
    }
    else {
      delete E.AC[trigger];
    }
  }
  return E;
};

})(BUE.instance.prototype, jQuery);

//Extend autocomplete list in your own postprocess:
//E.ACAdd('prefix', 'suffix');
//E.ACAdd({prefix1: suffix1, prefix2: suffix2,...});
//E.ACAdd('prefix', function(E, prefix){return suffix;});;

//Register button accesskeys as Ctrl shortcuts.
//Requires: none
BUE.preprocess.ctrl = function(E, $) {

  //store key-button relations.
  E.ctrlKeys = {};

  //get button keys
  $.each(E.buttons, function(i, B) {
    var pos, key;
    if (key = E.tpl.buttons[B.bid][3]) {//B.accessKey is not reliable since it is dynamically set on/off
      E.ctrlKeys[key.toUpperCase().charCodeAt(0)] = B;
      pos = B.title.lastIndexOf(' (');
      B.title = (pos < 0 ? B.title : B.title.substr(0, pos)) +' (Ctrl + '+ key +')';
    }
  });

  //register ctrl shortcuts for the editor.
  $(E.textArea).bind('keydown.bue', function(e) {
    if (e.ctrlKey && !e.shiftKey && !e.originalEvent.altKey && E.ctrlKeys[e.keyCode]) {
      E.ctrlKeys[e.keyCode].click();
      //Opera needs supression of keypress.
      $.browser.opera && $(this).one('keypress', function() {return false});
      return false;
    }
  });

};


//Extend or alter shortcuts in your own postprocess:
//E.ctrlKeys['YOUR_KEY_CODE'] = {click: YOUR_CALLBACK};
//Do not use F, O, and P as shortcut keys in IE and Safari as they will always fire their default action.;
//Introdue find & replace forms
//Requires: bue.popup.js, bue.markup.js
(function(E, $) {

//find a string inside editor content.
E.find = function (str, matchcase, regexp) {
  var E = this, from = E.posSelection().end, content = E.getContent();
  if (from == content.length) from = 0;
  var content = content.substr(from);
  var rgx = new RegExp(regexp ? str : BUE.regesc(str), matchcase ? '' : 'i');
  var index = content.search(rgx);
  if (index == -1) {
    if (from == 0) {
      alert(Drupal.t('No matching phrase found!'));
    }
    else if (confirmEOT()) {
      E.makeSelection(0, 0);
      E.find(str, matchcase, regexp);
    }
  }
  else {
    var strlen = regexp ? content.match(rgx)[0].length : str.length;
    index += from;
    E.makeSelection(index, index+strlen).scrollTo(index);
  }
  return E;
};

//replace str1 with str2.
E.replace = function(str1, str2, matchcase, regexp) {
  var E = this, s = E.getSelection(), rgx = new RegExp('^'+ (regexp ? str1 : BUE.regesc(str1)) +'$', matchcase ? '' : 'i');
  var found = s && s.search(rgx) == 0 || (s = E.find(str1, matchcase, regexp).getSelection()) && s.search(rgx) == 0;
  if (found && confirm(Drupal.t('Replace this occurance of "!text"?', {'!text': s}))) {
    str2 = regexp ? s.replace(new RegExp(str1, 'g' + (matchcase ? '' : 'i')), str2) : str2;
    E.replaceSelection(str2);
  }
  return E;
};

//replace all occurrences of str1 with str2.
E.replaceAll = function(str1, str2, matchcase, regexp) {
  var E = this, P = E.posSelection(), C = E.getContent(), n = 0;
  var R = new RegExp(regexp ? str1 : BUE.regesc(str1), 'g' + (matchcase ? '' : 'i'));
  var F = regexp ?  (function(s) {n++; return s.replace(R, str2)}) : (function() {n++; return str2;});
  var start = P.start == 0 || confirmEOT() ? 0 : P.start;
  E.setContent(C.substr(0, start) + C.substr(start).replace(R, F));
  alert(Drupal.t('Total replacements: !count', {'!count': n}));
  return E;
};

//scroll editor textarea to the specified character index. 
E.scrollTo = function(index) {
  var E = this, T = E.textArea, h = $(T).height();
  var sT = BUE.scrlT = BUE.scrlT || $(document.createElement('textarea')).css({width: $(T).width(), height: 1, visibility: 'hidden'}).appendTo(document.body)[0];
  sT.value = T.value.substr(0, index);
  T.scrollTop = sT.scrollHeight > h ? sT.scrollHeight - Math.ceil(h/2) : 0;
  return E;
};

//open Find & Replace form.
E.frForm = function() {
  var arg = arguments, F = theForm(), el = F.elements;
  var opt = typeof arg[0] == 'object' ? arg[0] : {isrep: arg[0], iscase: arg[1], isreg: arg[2], title: arg[3]};
  BUE.frPop.open(opt.title || (opt.isrep ? Drupal.t('Find & Replace') : Drupal.t('Search')));
  $(el.matchcase.parentNode)[opt.iscase ? 'show' : 'hide']();
  $(el.regexp.parentNode)[opt.isreg ? 'show' : 'hide']();
  $(el.replacetext).parents('div.bue-fr-row').add([el.replacebutton, el.replaceallbutton])[opt.isrep ? 'show' : 'hide']();
  return this;
};

//submit Find & Replace form.
E.frSubmit = function(B) {
  var E = this, el = B.form.elements, findtext = BUE.text(el.findtext.value);
  if (!findtext) {
    el.findtext.focus();
    return E;
  }
  var op = B.name, replacetext = BUE.text(el.replacetext.value);
  var matchcase = $(el.matchcase.parentNode).is(':visible') && el.matchcase.checked;
  var regexp = $(el.regexp.parentNode).is(':visible') && el.regexp.checked;
  switch (op) {
    case 'findbutton': E.find(findtext, matchcase, regexp); break;//find
    case 'replacebutton': E.replace(findtext, replacetext, matchcase, regexp); break;//replace
    case 'replaceallbutton': E.replaceAll(findtext, replacetext, matchcase, regexp); break;//replace all
  }
  return E;
};

//shortcuts
var H = BUE.html, I = BUE.input;

//confirmation message that will be used multiple times.
var confirmEOT = function() {
  return confirm(Drupal.t('End of textarea reached. Continue search at the beginning of textarea?'));
};

//cookie get & set
var K = function (name, value) {
  if (value === undefined) {//get
    return unescape((document.cookie.match(new RegExp('(^|;) *'+ name +'=([^;]*)(;|$)')) || ['', '', ''])[2]);
  }
  document.cookie = name +'='+ escape(value) +'; expires='+ (new Date(new Date()*1 + 30*86400000)).toGMTString() +'; path=/';//set
};

//return find&replace form
var theForm = function () {
  if (BUE.frForm) return BUE.frForm;
  var Dv = function(s, c) {return H('div', s, {style: 'margin-bottom: 4px', 'class': c||'bue-fr-row'})};
  var Ta = function(n) {return Dv(H('textarea', K('bfr_'+ n), {name: n, cols: 36, rows: 1, 'class': 'form-textarea'}), 'form-textarea-wrapper resizable')};
  var Cb = function(n, v) {return H('span', I('checkbox', n, '', {checked: K('bfr_'+ n) || null, 'class': 'form-checkbox'}) + v)};
  var Bt = function(n, v) {return I('button', n, v, {onclick: 'BUE.active.frSubmit(this)', 'class': 'form-submit'})};
  var F = Dv(Ta('findtext')) + Dv(Ta('replacetext'));
  F += Dv(Cb('matchcase', Drupal.t('Match case')) +' '+ Cb('regexp', Drupal.t('Regular expressions')));
  F += Dv(Bt('findbutton', Drupal.t('Find next')) +' '+ Bt('replacebutton', Drupal.t('Replace')) +' '+ Bt('replaceallbutton', Drupal.t('Replace all')));
  BUE.frPop = BUE.createPopup('bue-fr-pop', null, F = BUE.frForm = $(H('form', F))[0]);
  Drupal.behaviors.textarea && Drupal.behaviors.textarea.attach(F);
  $('div.grippie', F).height(4);
  $(window).unload(function() {
    if (!BUE.frForm) return;
    var el = BUE.frForm.elements;
    K('bfr_findtext', el.findtext.value);
    K('bfr_replacetext', el.replacetext.value);
    K('bfr_matchcase', el.matchcase.checked ? 'checked' : '');
    K('bfr_regexp', el.regexp.checked ? 'checked' : '');
  });
  return F;
};

})(BUE.instance.prototype, jQuery);

/*
Example button content to display just the find form:
js: E.frForm();
Example button content to display the whole find and replace form:
js: E.frForm({
  isrep: true, //enable replace
  iscase: true, //enable case sensitive switch
  isreg: true, //enable regular expression switch
  title: 'Replace some text' //custom title. defaults to 'Find & Replace'
});
*/

;
//Introduces cross-browser editor history with two new methods. E.undo() & E.redo()
//Requires: none
(function(E, $) {

//history object
BUE.history = function(E) {
  var H = this;
  H.bue = E;
  H.max= 50; //maximum number of states in undo/redo history
  //the key codes(not char codes) triggering state saving. (backspace, enter, space, del, V, X, comma, dot)
  H.keys= {'8': 1, '13': 1, '32': 1, '46': 1, '86': 1, '88': 1, '188': 1, '190': 0};
  H.period= 500; //minimum time needed to pass before saving successively triggered states.
  H.states= []; //stores the states
  H.current= -1; //index of the latest activated/stored state
  H.writable= true; //dynamic allowance of state saving.

  //attach textarea events triggering history operations.
  $(E.textArea).one('focus.bue', function(){H.save()}).bind('keyup.bue', function(e) {
    H.writable && (!H.keys || H.keys[e.keyCode]) && H.save();
  });

  //save history on setContent.
  E.historySetContent = E.setContent;
  E.setContent = function() {
    this.history.save();
    return this.historySetContent.apply(this, arguments);
  };
};

//history methods
var H = BUE.history.prototype;

//allow/disallow write permission
H.allow = function(){this.writable = true};
H.disallow = function(){this.writable = false};

//save textarea state.
H.save = function(bypass) {
  var H = this, E = H.bue;
  //chek write perm
  if (!bypass && !H.writable) {
    return;
  }
  H.disallow();
  setTimeout(function(){H.allow()}, H.period);
  //delete redo-states if any.
  while(H.states[H.current + 1]) {
    H.states.pop();
  }
  var val = E.getContent(), len = H.states.length;
  if (len && val == H.states[len-1].value) {
    return;
  }
  if (len == H.max) {
    H.states.shift();
    len--;
  }
  H.states[(H.current = len)] = {value: val, cursor: E.posSelection(), scrollTop: E.textArea.scrollTop};
};

//restore a state relative to the current state.
H.go = function(i) {
  var H = this, E = H.bue;
  i < 0 && H.current == H.states.length - 1 && H.save(true);
  var state, index = H.current + i;
  if (state = H.states[index]) {
    H.disallow();//prevent setContent save state.
    E.setContent(state.value);
    H.allow();
    E.makeSelection(state.cursor.start, state.cursor.end);
    E.textArea.scrollTop = state.scrollTop;
    H.current = index;
  }
};
  
//undo/redo for the editor.
E.undo = function() {this.history.go(-1); return this;};
E.redo = function() {this.history.go(1); return this;};

//create history for each editor instance
BUE.preprocess.history = function(E, $) {
  E.history = new BUE.history(E);
};

})(BUE.instance.prototype, jQuery);

//Change settings in your own postprocess.
//E.history.max = YOUR_MAXIMUM_NUMBER_OF_UNDO_STATES;
//E.history.keys['YOUR_KEYCODE_TRIGGERING_STATE_SAVE'] = 1;
//E.history.keys = false;//allows any key to trigger state saving.
//E.history.period = YOUR_MIN_TIME_IN_MILISECONDS_TO_PASS_BEFORE_SAVING_THE_NEXT_STATE;

//Create custom buttons for your editor
//Undo -> js: E.undo();
//Redo -> js: E.redo();
//Use with bue.ctrl.js and assign Z and Y keys to override browsers' default undo and redo functions.
;

//Automatically insert a new list item when enter-key is pressed at the end of a list item.
//Requires: none
BUE.preprocess.li = function(E, $) {

  $(E.textArea).bind('keyup.bue', function(e) {
    if (!e.ctrlKey && !e.shiftKey && !e.originalEvent.altKey && e.keyCode == 13) {
      var prefix = E.getContent().substr(0, E.posSelection().start);
      /<\/li>\s*$/.test(prefix) && E.tagSelection('<li>', '</li>');
    }
  });
 
};;

//Introduce indent(TAB), unindent(Shift+TAB), and auto indent(ENTER) in textareas.
//Requires: none
BUE.preprocess.tab = function(E, $) {

  E.tabs = {
    str: '  ', //character(s) to be inserted when TAB is pressed. Drupal way is to use double space.
    on: true, //initial state of tabs. Switchable by Ctrl+Alt+TAB
    autoin: true, //auto indent on enter.
    blocks: true //indent/unindent selected text blocks without overwriting.
  };

  $(E.textArea).bind('keydown.bue', function(e) {
    if (e.keyCode == 9) {
      if (e.ctrlKey && e.originalEvent.altKey) {//enable-disable
        E.tabs.on = !E.tabs.on;
        return false;
      }
      if (E.tabs.on && !e.ctrlKey && !e.originalEvent.altKey) {
        var tab = E.tabs.str;
        if (e.shiftKey) {//unindent
          var P = E.posSelection(), start = Math.max(0, P.start-tab.length);
          if (E.getContent().substring(start, P.start) == tab) {
            E.makeSelection(start, P.end);
          }
          E.replaceSelection(E.getSelection().replace(new RegExp('^' + tab), ''));
          E.replaceSelection(E.tabs.blocks ? E.getSelection().replace(new RegExp('\n' + tab, 'g'), '\n') : '');
        }
        else {//indent
          if (E.tabs.blocks) {
            E.replaceSelection(E.getSelection().replace(/\n/g, '\n' + tab)).tagSelection(tab, '');
          }
          else {
            E.replaceSelection(tab, 'end');
          }
        }
        //Opera needs suppression of keypress
        $.browser.opera && $(this).one('keypress', function() {return false});
        return false;
      }
    }
    //auto indent on enter
    else if (E.tabs.autoin && !e.ctrlKey && !e.shiftKey && !e.originalEvent.altKey && e.keyCode == 13) {
      var m, text = E.getContent().substr(0, E.posSelection().start);
      if (m = text.substr(text.lastIndexOf('\n') + 1).match(/^(\s+)/)) {
        E.replaceSelection('\n' + m[1], 'end');
        //Opera needs suppression of keypress
        $.browser.opera && $(this).one('keypress', function() {return false});
        return false;
      }
    }
  });
 
};


//Change settings in your own postprocess.
//E.tabs.str = 'YOUR_TAB_CHARACTER(S)';
//E.tabs.on = YOUR_BOOLEAN_FOR_INITIAL_STATE_OF_TABS;
//E.tabs.autoin = YOUR_BOOLEAN_FOR_AUTO_INDENT_ON_ENTER;
//E.tabs.blocks = YOUR_BOOLEAN_FOR_BLOCK_INDENTING;;
