/** Mint UI: small, framework-independent enhancements for semantic HTML. */
const selectControllers = new WeakMap();
const tabControllers = new WeakMap();
const disclosureControllers = new WeakMap();
let menuSequence = 0;
const stickyTableControllers = new WeakMap();

function listen(target, type, handler, disposers, options) {
  target.addEventListener(type, handler, options);
  disposers.push(() => target.removeEventListener(type, handler, options));
}

/** Build a labelled single-select without HTML interpolation. Data stays in the app. */
export function createSelect({label, options, value, document: doc = globalThis.document}) {
  const root = doc.createElement('div');
  root.className = 'mint-select';
  root.dataset.mintSelect = '';
  const trigger = doc.createElement('button');
  trigger.className = 'mint-select-trigger';
  trigger.dataset.mintTrigger = '';
  trigger.setAttribute('aria-label', label);
  const selected = doc.createElement('span');
  selected.dataset.mintValue = '';
  const arrow = doc.createElement('span');
  arrow.className = 'mint-select-chevron';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '⌄';
  trigger.append(selected, arrow);
  const menu = doc.createElement('div');
  menu.className = 'mint-select-menu';
  menu.dataset.mintMenu = '';
  menu.hidden = true;
  menu.setAttribute('aria-label', label);
  for (const item of options) {
    const option = doc.createElement('button');
    option.setAttribute('role', 'option');
    option.dataset.value = String(item.value);
    option.textContent = item.label;
    option.disabled = Boolean(item.disabled);
    option.setAttribute('aria-selected', String(String(item.value) === String(value)));
    menu.append(option);
  }
  root.append(trigger, menu);
  return {element: root, controller: initSelect(root)};
}

/** Enhance a custom listbox. Invalid values return false without changing it. */
export function initSelect(root) {
  if (selectControllers.has(root)) return selectControllers.get(root);
  const trigger = root?.querySelector('[data-mint-trigger]');
  const menu = root?.querySelector('[data-mint-menu]');
  const valueLabel = trigger?.querySelector('[data-mint-value]');
  const options = menu ? [...menu.querySelectorAll('button[role="option"][data-value]')] : [];
  if (!trigger || !menu || !valueLabel || !options.length) {
    throw new TypeError('Mint select requires a trigger, value label, menu, and button options.');
  }
  if (new Set(options.map(option => option.dataset.value)).size !== options.length) {
    throw new TypeError('Mint select option values must be unique.');
  }

  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const disposers = [];
  let selectedValue;
  let tabCloseTimer;
  let destroyed = false;
  let search = '';
  let searchTimer;
  let frame = 0;
  let closing = false;
  const topLayer = typeof menu.showPopover === 'function';
  const originalPopover = menu.getAttribute('popover');
  const originalStyle = menu.getAttribute('style');
  const placeholder = doc.createComment('mint-select-menu');
  const contains = node => node && (root.contains(node) || menu.contains(node));
  if (topLayer) menu.setAttribute('popover', 'manual');
  const enabled = () => options.filter(option => !option.disabled && option.getAttribute('aria-disabled') !== 'true');
  const labelFor = option => option.querySelector('[data-mint-option-label]') || option.querySelector('span') || option;

  if (!menu.id) {
    let id;
    do { id = `mint-menu-${++menuSequence}`; } while (doc.getElementById(id));
    menu.id = id;
  }
  trigger.setAttribute('aria-controls', menu.id);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.type = 'button';
  menu.setAttribute('role', 'listbox');
  for (const option of options) {
    option.type = 'button';
    option.tabIndex = -1;
  }

  function close(returnFocus = false) {
    // Moving a focused fallback menu fires focusout synchronously.
    if (closing) return;
    closing = true;
    try {
      if (topLayer && menu.matches(':popover-open')) menu.hidePopover();
      menu.hidden = true;
      if (placeholder.parentNode) placeholder.replaceWith(menu);
      menu.classList.remove('mint-select-floating');
      if (originalStyle === null) menu.removeAttribute('style');
      else menu.setAttribute('style', originalStyle);
      win.cancelAnimationFrame(frame);
      frame = 0;
      trigger.setAttribute('aria-expanded', 'false');
      search = '';
      win.clearTimeout(searchTimer);
      if (returnFocus && trigger.isConnected) trigger.focus({preventScroll: true});
    } finally {
      closing = false;
    }
  }

  function position() {
    frame = 0;
    if (menu.hidden || destroyed) return;
    const box = trigger.getBoundingClientRect();
    const viewport = win.visualViewport;
    const leftEdge = (viewport?.offsetLeft || 0) + 12;
    const topEdge = (viewport?.offsetTop || 0) + 12;
    const rightEdge = leftEdge + (viewport?.width || win.innerWidth) - 24;
    const bottomEdge = topEdge + (viewport?.height || win.innerHeight) - 24;
    if (!trigger.getClientRects().length || box.bottom < topEdge || box.top > bottomEdge) { close(); return; }
    const below = Math.max(0, bottomEdge - box.bottom - 8);
    const above = Math.max(0, box.top - topEdge - 8);
    const up = below < Math.min(menu.scrollHeight, 240) && above > below;
    menu.style.maxHeight = `${up ? above : below}px`;
    menu.style.minWidth = `${Math.min(Math.max(180, box.width), rightEdge - leftEdge)}px`;
    menu.style.maxWidth = `${Math.max(0, rightEdge - leftEdge)}px`;
    // Offset sizes are unaffected by the opening animation's transform.
    const size = {width: menu.offsetWidth, height: menu.offsetHeight};
    menu.style.left = `${Math.max(leftEdge, Math.min(box.left, rightEdge - size.width))}px`;
    menu.style.top = `${up ? Math.max(topEdge, box.top - size.height - 8) : box.bottom + 8}px`;
  }

  function schedulePosition() {
    if (!menu.hidden && !destroyed && !frame) frame = win.requestAnimationFrame(position);
  }

  function open(edge) {
    if (trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') return;
    const available = enabled();
    if (!available.length) return;
    win.clearTimeout(tabCloseTimer);
    if (!topLayer && !placeholder.parentNode) {
      // Older engines: portal outside clipping ancestors, retaining scoped theme tokens.
      const styles = win.getComputedStyle(root);
      for (const name of styles) if (name.startsWith('--mint-')) menu.style.setProperty(name, styles.getPropertyValue(name));
      menu.before(placeholder);
      doc.body.append(menu);
    }
    menu.classList.add('mint-select-floating');
    menu.hidden = false;
    if (topLayer && !menu.matches(':popover-open')) menu.showPopover();
    position();
    trigger.setAttribute('aria-expanded', 'true');
    const selected = available.find(option => option.dataset.value === selectedValue);
    (edge === 'first' ? available[0] : edge === 'last' ? available.at(-1) : selected || available[0]).focus({preventScroll: true});
    doc.activeElement?.scrollIntoView({block: 'nearest'});
  }

  function setValue(value, {emit = false} = {}) {
    if (destroyed) return false;
    const option = options.find(item => item.dataset.value === String(value));
    if (!option) return false;
    const changed = selectedValue !== option.dataset.value;
    selectedValue = option.dataset.value;
    for (const item of options) item.setAttribute('aria-selected', String(item === option));
    const label = labelFor(option);
    valueLabel.textContent = label.textContent.trim();
    const language = label.getAttribute('lang') || option.getAttribute('lang');
    if (language) valueLabel.setAttribute('lang', language);
    else valueLabel.removeAttribute('lang');
    if (emit && changed) {
      root.dispatchEvent(new win.CustomEvent('mint:change', {bubbles: true, detail: {value: selectedValue}}));
    }
    return true;
  }

  listen(trigger, 'click', () => menu.hidden ? open() : close(), disposers);
  listen(trigger, 'keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open(event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : undefined);
    } else if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      close();
    }
    // Enter and Space use the native button click, including assistive technology.
  }, disposers);

  listen(menu, 'click', event => {
    const option = event.target.closest?.('button[role="option"][data-value]');
    if (!options.includes(option) || !enabled().includes(option)) return;
    close(true);
    setValue(option.dataset.value, {emit: true});
  }, disposers);

  listen(menu, 'keydown', event => {
    const available = enabled();
    if (!available.length) return;
    const index = available.indexOf(doc.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % available.length;
    if (event.key === 'ArrowUp') next = (index - 1 + available.length) % available.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = available.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      available[next].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      // Start the native tab movement at the trigger, also for a portalled menu.
      trigger.focus({preventScroll: true});
      win.clearTimeout(tabCloseTimer);
      tabCloseTimer = win.setTimeout(() => close(), 0);
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      win.clearTimeout(searchTimer);
      search += event.key.toLocaleLowerCase();
      const term = [...search].every(character => character === search[0]) ? search[0] : search;
      const ordered = [...available.slice(index + 1), ...available.slice(0, index + 1)];
      ordered.find(option => labelFor(option).textContent.trim().toLocaleLowerCase().startsWith(term))?.focus();
      searchTimer = win.setTimeout(() => { search = ''; }, 700);
    }
    // Option buttons retain native Enter/Space selection; no synthetic double click.
  }, disposers);

  listen(doc, 'pointerdown', event => { if (!contains(event.target)) close(); }, disposers);
  const onFocusOut = event => { if (!contains(event.relatedTarget)) close(); };
  listen(root, 'focusout', onFocusOut, disposers);
  listen(menu, 'focusout', onFocusOut, disposers);
  listen(win, 'scroll', schedulePosition, disposers, {capture: true, passive: true});
  listen(win, 'resize', schedulePosition, disposers);
  if (win.visualViewport) {
    listen(win.visualViewport, 'resize', schedulePosition, disposers);
    listen(win.visualViewport, 'scroll', schedulePosition, disposers);
  }
  const resize = win.ResizeObserver ? new win.ResizeObserver(schedulePosition) : null;
  resize?.observe(trigger);
  resize?.observe(menu);

  setValue((options.find(option => option.getAttribute('aria-selected') === 'true') || enabled()[0] || options[0]).dataset.value);
  close();
  const controller = {
    get value() { return selectedValue; },
    setValue,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close(menu.contains(doc.activeElement));
      win.clearTimeout(tabCloseTimer);
      resize?.disconnect();
      disposers.forEach(dispose => dispose());
      if (originalPopover === null) menu.removeAttribute('popover');
      else menu.setAttribute('popover', originalPopover);
      selectControllers.delete(root);
    }
  };
  selectControllers.set(root, controller);
  return controller;
}

/** Position the active indicator; the application still owns routing and panels. */
export function initTabs(root) {
  if (tabControllers.has(root)) return tabControllers.get(root);
  if (!root?.querySelector) throw new TypeError('Mint tabs requires a navigation element.');
  const win = root.ownerDocument.defaultView;
  const disposers = [];
  const previous = ['--tab-left', '--tab-top', '--tab-width', '--tab-height'].map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
  const itemSelector = 'a[aria-current],button[aria-current],a[aria-selected],button[aria-selected],button[aria-pressed]';
  const observed = new Set();
  let frame = 0;
  let destroyed = false;

  function measure() {
    frame = 0;
    if (destroyed) return;
    const active = root.querySelector('a[aria-current="page"],button[aria-current="page"],a[aria-selected="true"],button[aria-selected="true"],button[aria-pressed="true"]');
    const bounds = root.getBoundingClientRect();
    const activeBounds = active?.getBoundingClientRect();
    root.style.setProperty('--tab-left', `${activeBounds ? activeBounds.left - bounds.left + root.scrollLeft - root.clientLeft : 0}px`);
    root.style.setProperty('--tab-top', `${activeBounds ? activeBounds.top - bounds.top + root.scrollTop - root.clientTop : 0}px`);
    root.style.setProperty('--tab-width', `${activeBounds?.width || 0}px`);
    root.style.setProperty('--tab-height', `${activeBounds?.height || 0}px`);
  }

  function refresh() {
    if (!destroyed && !frame) frame = win.requestAnimationFrame(measure);
  }

  const resizeObserver = win.ResizeObserver ? new win.ResizeObserver(refresh) : null;
  resizeObserver?.observe(root);
  function observeItems() {
    const items = new Set(root.querySelectorAll(itemSelector));
    for (const item of observed) {
      if (!items.has(item)) { resizeObserver?.unobserve(item); observed.delete(item); }
    }
    for (const item of items) {
      if (!observed.has(item)) { resizeObserver?.observe(item); observed.add(item); }
    }
    refresh();
  }
  const mutations = new win.MutationObserver(observeItems);
  mutations.observe(root, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current', 'aria-selected', 'aria-pressed']});
  listen(win, 'resize', refresh, disposers);
  listen(root, 'scroll', refresh, disposers, {passive: true});
  const fonts = root.ownerDocument.fonts;
  if (fonts) {
    fonts.ready.then(refresh);
    listen(fonts, 'loadingdone', refresh, disposers);
  }
  observeItems();

  const controller = {
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.cancelAnimationFrame(frame);
      mutations.disconnect();
      resizeObserver?.disconnect();
      disposers.forEach(dispose => dispose());
      for (const [name, value, priority] of previous) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
      tabControllers.delete(root);
    }
  };
  tabControllers.set(root, controller);
  return controller;
}

function durationInMilliseconds(value, fallback) {
  const match = value.trim().match(/^([\d.]+)(ms|s)$/);
  return match ? Number(match[1]) * (match[2] === 's' ? 1000 : 1) : fallback;
}

/** Animate a native details element without replacing its keyboard semantics. */
export function initDisclosure(details) {
  if (disclosureControllers.has(details)) return disclosureControllers.get(details);
  const summary = details?.querySelector(':scope > summary');
  if (details?.tagName !== 'DETAILS' || !summary) throw new TypeError('Mint disclosure requires details with a direct summary.');
  const win = details.ownerDocument.defaultView;
  const disposers = [];
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const originalOverflow = [details.style.getPropertyValue('overflow'), details.style.getPropertyPriority('overflow')];
  let animation = null;
  let desiredOpen = details.open;
  let destroyed = false;

  function restoreOverflow() {
    if (originalOverflow[0]) details.style.setProperty('overflow', ...originalOverflow);
    else details.style.removeProperty('overflow');
  }

  function cancelAnimation() {
    if (animation) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
      animation = null;
    }
    restoreOverflow();
  }

  function settle() {
    cancelAnimation();
    details.open = desiredOpen;
  }

  listen(summary, 'click', event => {
    if (event.defaultPrevented || event.target.closest?.('a,button,input,select,textarea,[contenteditable="true"]')) return;
    event.preventDefault();
    desiredOpen = !desiredOpen;
    const startHeight = details.getBoundingClientRect().height;
    cancelAnimation();
    if (reducedMotion.matches || typeof details.animate !== 'function') { settle(); return; }

    // Measure the browser's actual closed/open layout, including padding and borders.
    details.open = desiredOpen;
    const endHeight = details.getBoundingClientRect().height;
    details.open = true;
    const styles = win.getComputedStyle(details);
    const extra = styles.boxSizing === 'border-box' ? 0 : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(styles[key]) || 0), 0);
    const duration = durationInMilliseconds(styles.getPropertyValue('--mint-duration-disclosure'), 360);
    const easing = styles.getPropertyValue('--mint-ease').trim() || 'cubic-bezier(.22, 1, .36, 1)';
    if (!duration || Math.abs(startHeight - endHeight) < 0.5) { settle(); return; }
    details.style.overflow = 'hidden';
    try {
      animation = details.animate(
        [{height: `${Math.max(0, startHeight - extra)}px`}, {height: `${Math.max(0, endHeight - extra)}px`}],
        {duration, easing}
      );
      animation.onfinish = settle;
      animation.oncancel = settle;
    } catch {
      settle();
    }
  }, disposers);
  listen(details, 'toggle', () => {
    if (!animation) desiredOpen = details.open;
    else if (!details.open) { desiredOpen = false; settle(); }
  }, disposers);
  listen(reducedMotion, 'change', () => { if (reducedMotion.matches) settle(); }, disposers);

  const controller = {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      settle();
      disposers.forEach(dispose => dispose());
      disclosureControllers.delete(details);
    }
  };
  disclosureControllers.set(details, controller);
  return controller;
}

/** Keep a read-only table heading at the viewport edge, even with horizontal scrolling.
 * The semantic header stays in the table; an inert visual copy is bounded by its table.
 */
const columnToggleControllers = new WeakMap();

/** Toggle a named group of table columns; labels and content belong to the app. */
export function initColumnToggle(root) {
  if (columnToggleControllers.has(root)) return columnToggleControllers.get(root);
  const buttons = [...root.querySelectorAll('[data-mint-columns-toggle]')];
  function setExpanded(group, expanded) {
    for (const cell of root.querySelectorAll('[data-mint-column]')) {
      if (cell.dataset.mintColumn === group) cell.hidden = !expanded;
    }
    for (const button of buttons) {
      if (button.dataset.mintColumnsToggle !== group) continue;
      button.setAttribute('aria-expanded', String(expanded));
      button.querySelectorAll('[data-mint-collapsed-label]').forEach(label => label.hidden = expanded);
      button.querySelectorAll('[data-mint-expanded-label]').forEach(label => label.hidden = !expanded);
    }
    for (const table of root.querySelectorAll('table')) {
      const count = [...(table.tHead?.rows[0]?.cells || [])].filter(cell => !cell.hidden).reduce((sum, cell) => sum + cell.colSpan, 0);
      table.querySelectorAll('[data-mint-colspan]').forEach(cell => cell.colSpan = Math.max(1, count));
    }
  }
  const disposers = [];
  for (const button of buttons) {
    setExpanded(button.dataset.mintColumnsToggle, button.getAttribute('aria-expanded') === 'true');
    listen(button, 'click', () => setExpanded(button.dataset.mintColumnsToggle, button.getAttribute('aria-expanded') !== 'true'), disposers);
  }
  const controller = {setExpanded, destroy() {
    disposers.forEach(dispose => dispose());
    columnToggleControllers.delete(root);
  }};
  columnToggleControllers.set(root, controller);
  return controller;
}

export function initStickyTable(root) {
  if (stickyTableControllers.has(root)) return stickyTableControllers.get(root);
  const table = root?.querySelector('table');
  const head = table?.tHead;
  if (!head) throw new TypeError('Mint sticky table requires a table with a thead.');
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const disposers = [];
  const overlay = doc.createElement('div');
  overlay.className = 'mint-app mint-sticky-table-head';
  overlay.dataset.mintStickyOverlay = '';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  overlay.hidden = true;
  doc.body.append(overlay);
  let frame = 0;
  let dirty = true;
  let destroyed = false;

  function rebuild() {
    const styles = win.getComputedStyle(root);
    for (let i = 0; i < styles.length; i++) {
      const name = styles[i];
      if (name.startsWith('--mint-')) overlay.style.setProperty(name, styles.getPropertyValue(name));
    }
    overlay.lang = root.closest('[lang]')?.lang || doc.documentElement.lang;
    const copy = table.cloneNode(false);
    copy.removeAttribute('id');
    copy.removeAttribute('aria-labelledby');
    copy.className = 'mint-table';
    const clonedHead = head.cloneNode(true);
    for (const element of [clonedHead, ...clonedHead.querySelectorAll('*')]) element.removeAttribute('id');
    const originals = [...head.querySelectorAll('th, td')];
    clonedHead.querySelectorAll('th, td').forEach((cell, i) => {
      const source = originals[i];
      const computed = win.getComputedStyle(source);
      for (const name of ['font-family','font-size','font-weight','line-height','letter-spacing','text-align','white-space','padding-top','padding-right','padding-bottom','padding-left','border-bottom-width','border-bottom-style','border-bottom-color','background-color','color']) cell.style.setProperty(name, computed.getPropertyValue(name));
      const width = computed.width;
      cell.style.width = width;
      cell.style.minWidth = width;
      cell.style.maxWidth = width;
      cell.style.boxSizing = 'border-box';
    });
    copy.append(clonedHead);
    copy.style.width = win.getComputedStyle(table).width;
    copy.style.tableLayout = 'fixed';
    copy.style.clipPath = `inset(0 round ${styles.borderTopLeftRadius} ${styles.borderTopRightRadius} 0 0)`;
    overlay.replaceChildren(copy);
    dirty = false;
  }

  function measure() {
    frame = 0;
    if (destroyed) return;
    const bounds = root.getBoundingClientRect();
    const tableBounds = table.getBoundingClientRect();
    const heading = head.getBoundingClientRect();
    const top = parseFloat(win.getComputedStyle(root).getPropertyValue('--mint-sticky-top')) || 0;
    if (!root.getClientRects().length || !bounds.width || heading.top >= top || tableBounds.bottom <= top) {
      overlay.hidden = true;
      return;
    }
    if (dirty) rebuild();
    overlay.style.left = bounds.left + root.clientLeft + 'px';
    overlay.style.width = root.clientWidth + 'px';
    overlay.style.height = heading.height + 'px';
    overlay.style.top = Math.min(top, tableBounds.bottom - heading.height) + 'px';
    overlay.hidden = false;
    overlay.scrollLeft = root.scrollLeft;
  }
  function schedule() {
    if (!destroyed && !frame) frame = win.requestAnimationFrame(measure);
  }
  function refresh() { dirty = true; schedule(); }
  listen(win, 'scroll', schedule, disposers, {capture: true, passive: true});
  listen(win, 'resize', refresh, disposers);
  listen(doc, 'animationend', event => { if (event.target.contains(root)) refresh(); }, disposers);
  const resize = win.ResizeObserver ? new win.ResizeObserver(refresh) : null;
  resize?.observe(root);
  resize?.observe(table);
  const mutations = new win.MutationObserver(refresh);
  mutations.observe(head, {subtree: true, childList: true, characterData: true, attributes: true});
  for (let ancestor = root; ancestor; ancestor = ancestor.parentElement) mutations.observe(ancestor, {attributes: true, attributeFilter: ['hidden','lang','class','data-mint-theme']});
  doc.fonts?.ready.then(refresh);
  if (doc.fonts) listen(doc.fonts, 'loadingdone', refresh, disposers);
  schedule();
  const controller = {refresh, destroy() {
    if (destroyed) return;
    destroyed = true;
    win.cancelAnimationFrame(frame);
    resize?.disconnect();
    mutations.disconnect();
    disposers.forEach(dispose => dispose());
    overlay.remove();
    stickyTableControllers.delete(root);
  }};
  stickyTableControllers.set(root, controller);
  return controller;
}

/** Enhance a document/subtree. Repeated calls reuse each element's controller. */
export function initMintUI(root = document) {
  const find = selector => [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  const selects = find('[data-mint-select]').map(initSelect);
  const tabs = find('[data-mint-tabs]').map(initTabs);
  const disclosures = find('[data-mint-disclosure]').map(initDisclosure);
  const columnToggles = find('[data-mint-column-toggle]').map(initColumnToggle);
  const stickyTables = find('[data-mint-sticky-table]').map(initStickyTable);
  return {
    selects,
    tabs,
    disclosures,
    stickyTables,
    columnToggles,
    destroy() { [...selects, ...tabs, ...disclosures, ...columnToggles, ...stickyTables].forEach(controller => controller.destroy()); }
  };
}
