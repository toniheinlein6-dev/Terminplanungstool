(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const STATUS = { new: 'Neu', in_progress: 'In Bearbeitung', done: 'Aufgenommen · erledigt', rejected: 'Abgelehnt' };
  const CATEGORY = { bug: 'Fehler', improvement: 'Verbesserungswunsch', question: 'Frage' };
  const DRAFT_KEY = 'tp-ticket-login-draft';
  let me = null, tickets = [], selected = null, selectedEvents = [], editing = false, editInitial = '', conflictCurrent = null, savedDraftValues = null;
  let creating = false, saving = false, detailToken = 0, refreshPromise = null, lastRefresh = 0, detailOpener = null, listLoaded = false, reauthenticating = false;

  const text = (id, value) => { $(id).textContent = value == null ? '' : String(value); };
  const node = (tag, value, className) => {
    const n = document.createElement(tag);
    if (value != null) n.textContent = String(value);
    if (className) n.className = className;
    return n;
  };
  function message(id, value, bad = false) {
    text(id, value); $(id).classList.toggle('error', bad);
  }
  function date(value, full = true) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '–';
    return full ? d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString('de-DE');
  }
  function person(name) { return name || 'Gelöschter Benutzer'; }
  function badge(status) {
    return node('span', STATUS[status] || 'Unbekannter Status', 'pill status-' + (STATUS[status] ? status : 'new'));
  }
  function formValues(prefix) {
    const values = {
      title: $(prefix === 'create' ? 'create-ticket-title' : 'edit-title').value,
      description: $(prefix + '-description').value,
      category: $(prefix + '-category').value
    };
    if (prefix === 'edit') { values.status = $('edit-status').value; values.response = $('edit-response').value; }
    return values;
  }
  function setForm(prefix, values) {
    $(prefix === 'create' ? 'create-ticket-title' : 'edit-title').value = values.title || '';
    $(prefix + '-description').value = values.description || '';
    $(prefix + '-category').value = values.category || '';
    if (prefix === 'edit') { $('edit-status').value = values.status || 'new'; $('edit-response').value = values.response || ''; responseRequired(); }
    clearValidation(prefix);
  }
  function editDirty() { return editing && JSON.stringify(formValues('edit')) !== editInitial; }
  function editUnsaved() { return editDirty() || (editing && !$('saved-draft').hidden); }
  function createDirty() { return Object.values(formValues('create')).some(value => value.length > 0); }
  function clearValidation(prefix) {
    $(prefix + '-form').querySelectorAll('input,select,textarea').forEach(field => field.setCustomValidity(''));
  }
  function validate(prefix) {
    clearValidation(prefix);
    const values = formValues(prefix), title = $(prefix === 'create' ? 'create-ticket-title' : 'edit-title');
    if (values.title.trim().length < 3 || values.title.trim().length > 160) title.setCustomValidity('Bitte einen Titel mit 3 bis 160 Zeichen eingeben.');
    if (values.description.trim().length < 10 || values.description.trim().length > 10000) $(prefix + '-description').setCustomValidity('Bitte eine Beschreibung mit 10 bis 10.000 Zeichen eingeben.');
    if (prefix === 'edit' && values.status === 'rejected' && !values.response.trim()) $('edit-response').setCustomValidity('Bitte begründe die Ablehnung in der Rückmeldung.');
    return $(prefix + '-form').reportValidity();
  }
  function responseRequired() {
    const required = $('edit-status').value === 'rejected';
    $('edit-response').required = required;
    text('edit-response-label', required ? 'Rückmeldung / Begründung *' : 'Rückmeldung');
    $('edit-response').setCustomValidity('');
  }
  function preserveForLogin() {
    if (!me) return;
    const draft = { userId: String(me.id), ticketId: selected ? selected.id : null };
    if ($('create-dialog').open && createDirty()) draft.create = formValues('create');
    if (editing) draft.edit = { values: formValues('edit'), base: selected.version, previous: savedDraftValues };
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* Speicherung kann im Browser deaktiviert sein. */ }
  }
  function friendlyError(error) {
    if (error.status === 401) return 'Deine Sitzung ist abgelaufen. Bitte erneut anmelden.';
    if (error.status === 403) return 'Für diese Aktion fehlen dir die Berechtigungen. Bitte lade die Seite neu, falls deine Rolle geändert wurde.';
    if (error.status === 404) return 'Dieses Ticket wurde nicht gefunden.';
    if (error.status === 413) return 'Die Eingaben sind zu umfangreich. Bitte kürze sie und versuche es erneut.';
    if (error.status === 429) return 'Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.';
    if (error.status >= 500) return 'Der Server ist momentan nicht verfügbar. Bitte versuche es erneut. Deine Eingaben bleiben erhalten.';
    if (error.status && error.data && error.data.error && !['forbidden', 'login', 'conflict'].includes(error.data.error)) return error.data.error;
    return 'Keine Verbindung zum Server. Bitte prüfe deine Verbindung und versuche es erneut. Deine Eingaben bleiben erhalten.';
  }
  async function api(action, body, params) {
    const query = new URLSearchParams({ a: action, ...params });
    const options = { credentials: 'same-origin', cache: 'no-store' };
    if (body !== undefined) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TP': '1' }, body: JSON.stringify(body) });
    const response = await fetch('api/tp?' + query, options);
    const result = await response.json().catch(() => ({}));
    if (response.status === 401 && !reauthenticating) {
      preserveForLogin(); reauthenticating = true;
      location.assign('index.html?next=tickets.html' + (hashId() ? '#' + encodeURIComponent(hashId()) : ''));
    }
    if (!response.ok) { const error = new Error(result.error || 'Serverfehler'); error.status = response.status; error.data = result; throw error; }
    return result;
  }

  function renderList() {
    const query = $('search').value.trim().toLocaleLowerCase('de-DE');
    const status = $('filter-status').value, category = $('filter-category').value, mine = $('filter-mine').checked;
    const filtered = tickets.filter(ticket => (!status || ticket.status === status) && (!category || ticket.category === category) &&
      (!mine || (ticket.createdBy != null && String(ticket.createdBy) === String(me.id))) &&
      (!query || [ticket.id, ticket.title, ticket.description, ticket.response, ticket.createdByName].join(' ').toLocaleLowerCase('de-DE').includes(query)));
    const counts = { new: 0, in_progress: 0, done: 0, rejected: 0 };
    tickets.forEach(ticket => { if (Object.hasOwn(counts, ticket.status)) counts[ticket.status]++; });
    Object.entries(counts).forEach(([key, value]) => text('count-' + key, value));
    text('list-count', filtered.length + ' von ' + tickets.length + (tickets.length === 1 ? ' Ticket' : ' Tickets'));
    $('reset-filters').hidden = !(query || status || category || mine);
    const focusedId = document.activeElement && document.activeElement.dataset.ticket;
    const rows = document.createDocumentFragment();
    let focusedLink = null;
    filtered.forEach(ticket => {
      const row = node('tr'), main = node('td'), link = node('a', ticket.title, 'ticket-link');
      link.href = '#' + encodeURIComponent(ticket.id); link.dataset.ticket = ticket.id;
      if (focusedId === ticket.id) focusedLink = link;
      main.append(node('div', ticket.id + ' · ' + (CATEGORY[ticket.category] || 'Ticket'), 'ticket-id'), link, node('p', ticket.description || 'Keine Beschreibung hinterlegt.', 'preview'));
      const state = node('td'); state.append(badge(ticket.status));
      const author = node('td', person(ticket.createdByName), 'by-column');
      const created = node('td', date(ticket.createdAt, false), 'date-column'); created.title = date(ticket.createdAt);
      row.append(main, state, author, created); rows.append(row);
    });
    $('ticket-list').replaceChildren(rows);
    if (focusedLink) focusedLink.focus({ preventScroll: true });
    $('ticket-table').hidden = !filtered.length;
    $('empty-state').hidden = !!filtered.length;
    text('empty-title', tickets.length ? 'Keine passenden Tickets' : 'Noch keine Tickets eingereicht');
    text('empty-hint', tickets.length ? 'Passe die Suche oder Filter an, um weitere Tickets zu sehen.' : 'Mit „Ticket einreichen“ kannst du einen Fehler oder Verbesserungswunsch melden.');
  }
  async function refreshList(manual = false) {
    if (!me || refreshPromise) return refreshPromise;
    $('refresh').disabled = true;
    refreshPromise = (async () => {
      try {
        const result = await api('tickets_list');
        const incoming = (result.tickets || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
        const changed = JSON.stringify(incoming) !== JSON.stringify(tickets);
        tickets = incoming; lastRefresh = Date.now();
        if (changed || manual || !listLoaded || $('page-message').classList.contains('error')) renderList();
        listLoaded = true;
        if (manual) message('page-message', 'Die Ticketübersicht ist aktuell.');
        else if ($('page-message').classList.contains('error')) message('page-message', '');
        if (selected && $('detail-dialog').open) {
          const current = tickets.find(ticket => ticket.id === selected.id);
          if (current && (manual || Number(current.version) !== Number(selected.version))) {
            if (editing) { if (Number(current.version) !== Number(selected.version)) $('stale-notice').hidden = false; }
            else await loadTicket(selected.id, false);
          }
        }
      } catch (error) {
        message('page-message', friendlyError(error), true);
        if (!tickets.length) { text('list-count', 'Tickets konnten nicht geladen werden.'); $('ticket-table').hidden = true; }
      } finally { refreshPromise = null; $('refresh').disabled = false; }
    })();
    return refreshPromise;
  }

  function snapshotContent(snapshot) {
    const container = node('div');
    const entry = (label, value) => { container.append(node('h4', label), node('p', value || '–', 'text')); };
    entry('Titel', snapshot.title);
    entry('Kategorie / Status', (CATEGORY[snapshot.category] || 'Ticket') + ' · ' + (STATUS[snapshot.status] || 'Unbekannt'));
    entry('Beschreibung', snapshot.description);
    entry('Rückmeldung', snapshot.response || 'Noch keine Rückmeldung.');
    return container;
  }
  function renderHistory(events) {
    const fragment = document.createDocumentFragment();
    events.slice().sort((a, b) => Number(b.version) - Number(a.version)).forEach(event => {
      const item = node('details', null, 'history-item'), summary = node('summary');
      const kind = event.kind === 'created' ? 'Eingereicht' : event.kind === 'restored' ? 'Aus Sicherung wiederhergestellt' : 'Bearbeitet';
      summary.append(node('strong', 'Version ' + event.version + ' · ' + kind + ' · '), document.createTextNode(date(event.at) + ' · ' + person(event.byName) + ' · ' + (STATUS[event.status] || 'Unbekannt')));
      const body = snapshotContent(event); body.className = 'history-body'; item.append(summary, body); fragment.append(item);
    });
    if (!events.length) fragment.append(node('p', 'Noch kein Verlauf vorhanden.', 'muted'));
    $('ticket-history').replaceChildren(fragment);
  }
  function syncTicketView(ticket) {
    text('detail-number', ticket.id); text('detail-title', ticket.title);
    $('detail-status').replaceChildren(badge(ticket.status));
    text('detail-category', CATEGORY[ticket.category] || 'Ticket'); text('detail-version', ticket.version);
    $('detail-project-row').hidden = !ticket.projectId; text('detail-project', ticket.projectId);
    text('detail-author', person(ticket.createdByName)); text('detail-created', date(ticket.createdAt));
    text('detail-editor', person(ticket.updatedByName)); text('detail-updated', date(ticket.updatedAt));
    text('detail-description', ticket.description || 'Keine Beschreibung hinterlegt.'); text('detail-response', ticket.response || 'Noch keine Rückmeldung.');
  }
  function renderTicket(ticket, events) {
    selected = ticket; selectedEvents = events || [];
    syncTicketView(ticket);
    $('edit-ticket').hidden = me.role !== 'admin' || editing;
    $('detail-content').hidden = false;
    renderHistory(selectedEvents);
  }
  async function loadTicket(id, showLoading = true) {
    const token = ++detailToken;
    if (showLoading) {
      selected = null; text('detail-title', 'Ticket wird geladen …'); text('detail-number', id);
      $('detail-content').hidden = true; message('detail-message', 'Ticket wird geladen …');
    }
    try {
      const result = await api('ticket_get', undefined, { id });
      if (token !== detailToken || !$('detail-dialog').open) return false;
      // Eine bereits gestartete Aktualisierung darf die Bearbeitungsgrundlage nicht nachträglich verschieben.
      if (editing && !showLoading) {
        if (selected && Number(result.ticket.version) !== Number(selected.version)) $('stale-notice').hidden = false;
        return true;
      }
      renderTicket(result.ticket, result.events); message('detail-message', ''); return true;
    } catch (error) {
      if (token !== detailToken || !$('detail-dialog').open) return false;
      message('detail-message', friendlyError(error), true);
      const retry = node('button', 'Erneut versuchen'); retry.type = 'button';
      retry.addEventListener('click', () => loadTicket(id, !selected)); $('detail-message').append(document.createTextNode(' '), retry);
      return false;
    }
  }
  function clearEditState() {
    editing = false; editInitial = ''; conflictCurrent = null; savedDraftValues = null;
    $('edit-form').hidden = true; $('ticket-readonly').hidden = false;
    $('stale-notice').hidden = true; $('conflict-box').hidden = true; $('saved-draft').hidden = true;
    $('saved-draft-content').replaceChildren(); $('submit-edit').disabled = false; message('edit-message', '');
    if (me) $('edit-ticket').hidden = me.role !== 'admin';
  }
  function startEditing() {
    if (!selected || me.role !== 'admin') return;
    message('detail-message', '');
    setForm('edit', selected); editInitial = JSON.stringify(formValues('edit')); editing = true;
    $('edit-ticket').hidden = true; $('ticket-readonly').hidden = true; $('edit-form').hidden = false;
    $('edit-title').focus();
  }
  function setHash(id) {
    const url = new URL(location.href); url.searchParams.delete('ticket'); url.hash = id ? encodeURIComponent(id) : '';
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function hashId() {
    try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; }
  }
  async function openTicket(id, opener) {
    if (!id) return;
    if (saving || (selected && selected.id !== id && editUnsaved() && !confirm('Deine Änderungen wurden noch nicht gespeichert. Bearbeitung verwerfen?'))) {
      if (selected) setHash(selected.id); return;
    }
    if ($('detail-dialog').open && selected && selected.id === id) return;
    detailOpener = opener || document.activeElement;
    clearEditState();
    if (!$('detail-dialog').open) $('detail-dialog').showModal();
    await loadTicket(id);
  }
  function closeDetail() {
    if (saving) return;
    if (editUnsaved() && !confirm('Deine Änderungen wurden noch nicht gespeichert. Bearbeitung verwerfen?')) { if (selected) setHash(selected.id); return; }
    clearEditState(); selected = null; detailToken++; setHash(''); $('detail-dialog').close();
    if (detailOpener && detailOpener.isConnected) detailOpener.focus({ preventScroll: true });
  }
  function closeCreate() {
    if (creating) return;
    if (createDirty() && !confirm('Dein Ticket wurde noch nicht eingereicht. Eingaben verwerfen?')) return;
    $('create-form').reset(); clearValidation('create'); message('create-message', ''); $('create-dialog').close(); $('new-ticket').focus();
  }

  $('new-ticket').addEventListener('click', () => { message('create-message', ''); $('create-dialog').showModal(); $('create-category').focus(); });
  $('close-create').addEventListener('click', closeCreate); $('cancel-create').addEventListener('click', closeCreate);
  $('create-dialog').addEventListener('cancel', event => { event.preventDefault(); closeCreate(); });
  $('close-detail').addEventListener('click', closeDetail);
  $('detail-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
  $('edit-ticket').addEventListener('click', startEditing);
  $('cancel-edit').addEventListener('click', () => {
    if (editUnsaved() && !confirm('Deine Änderungen wurden noch nicht gespeichert. Bearbeitung verwerfen?')) return;
    clearEditState(); if (selected) loadTicket(selected.id, false); $('edit-ticket').focus();
  });
  $('edit-status').addEventListener('change', responseRequired);
  ['create', 'edit'].forEach(prefix => $(prefix + '-form').addEventListener('input', event => {
    if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
  }));
  $('create-form').addEventListener('submit', async event => {
    event.preventDefault(); if (creating || !validate('create')) return;
    creating = true; $('create-fields').disabled = true; text('submit-create', 'Wird eingereicht …'); message('create-message', '');
    try {
      const result = await api('ticket_create', formValues('create'));
      $('create-form').reset(); $('create-dialog').close(); message('page-message', 'Dein Ticket wurde eingereicht.');
      setHash(result.ticket.id); await openTicket(result.ticket.id, $('new-ticket')); await refreshList();
    } catch (error) { message('create-message', friendlyError(error), true); }
    finally { creating = false; $('create-fields').disabled = false; text('submit-create', 'Ticket einreichen'); }
  });
  $('edit-form').addEventListener('submit', async event => {
    event.preventDefault(); if (saving || !selected || conflictCurrent || !validate('edit')) return;
    saving = true; $('edit-fields').disabled = true; text('submit-edit', 'Wird gespeichert …'); message('edit-message', '');
    try {
      const result = await api('ticket_update', { id: selected.id, base: selected.version, ...formValues('edit') });
      clearEditState(); renderTicket(result.ticket, selectedEvents);
      const loaded = await loadTicket(result.ticket.id, false);
      if (loaded) message('detail-message', 'Änderungen gespeichert.');
      else $('detail-message').prepend(document.createTextNode('Änderungen gespeichert. '));
      await refreshList(); $('edit-ticket').focus();
    } catch (error) {
      if (error.status === 409 && error.data && error.data.current) {
        message('detail-message', '');
        conflictCurrent = error.data.current;
        $('conflict-current').replaceChildren(snapshotContent(conflictCurrent)); $('conflict-box').hidden = false;
        $('submit-edit').disabled = true; $('load-current').focus();
      } else message('edit-message', friendlyError(error), true);
    } finally { saving = false; $('edit-fields').disabled = false; text('submit-edit', 'Änderungen speichern'); }
  });
  $('load-current').addEventListener('click', async () => {
    if (!conflictCurrent || saving) return;
    const draft = formValues('edit'); savedDraftValues = draft;
    $('saved-draft-content').replaceChildren(snapshotContent(draft)); $('saved-draft').hidden = false;
    selected = conflictCurrent; conflictCurrent = null; setForm('edit', selected); editInitial = JSON.stringify(formValues('edit'));
    $('conflict-box').hidden = true; $('stale-notice').hidden = true; $('submit-edit').disabled = false;
    syncTicketView(selected);
    message('edit-message', ''); message('detail-message', 'Der aktuelle Stand ist im Formular. Dein bisheriger Entwurf steht darüber zum Vergleichen bereit.'); $('edit-title').focus();
    const id = selected.id;
    try {
      const result = await api('ticket_get', undefined, { id });
      if (selected && selected.id === id && $('detail-dialog').open) {
        renderHistory(result.events || []);
        if (result.ticket.version !== selected.version) $('stale-notice').hidden = false;
      }
    } catch (error) { message('detail-message', 'Der aktuelle Formularstand ist geladen. Der Verlauf konnte noch nicht aktualisiert werden.', true); }
  });
  ['search', 'filter-status', 'filter-category', 'filter-mine'].forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { if (me) renderList(); }));
  $('reset-filters').addEventListener('click', () => {
    $('search').value = ''; $('filter-status').value = ''; $('filter-category').value = ''; $('filter-mine').checked = false; renderList(); $('search').focus();
  });
  $('refresh').addEventListener('click', () => refreshList(true));
  $('ticket-list').addEventListener('click', event => {
    const link = event.target.closest('a[data-ticket]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); setHash(link.dataset.ticket); openTicket(link.dataset.ticket, link);
  });
  window.addEventListener('hashchange', () => { if (!me) return; const id = hashId(); if (id) openTicket(id); else if ($('detail-dialog').open) closeDetail(); });
  window.addEventListener('beforeunload', event => {
    if (!reauthenticating && (editUnsaved() || ($('create-dialog').open && createDirty()))) { event.preventDefault(); event.returnValue = ''; }
  });
  function refreshIfVisible() { if (!document.hidden && me && !creating && !saving && Date.now() - lastRefresh > 3000) refreshList(); }
  window.addEventListener('focus', refreshIfVisible);
  document.addEventListener('visibilitychange', refreshIfVisible);
  setInterval(refreshIfVisible, 30000);

  async function boot() {
    try {
      const linkedTicket = new URLSearchParams(location.search).get('ticket');
      if (!location.hash && linkedTicket) setHash(linkedTicket);
      me = (await api('me')).user;
      text('user-name', me.name + (me.role === 'admin' ? ' · Administration' : ''));
      $('new-ticket').disabled = false;
      await refreshList();
      let draft = null;
      try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* Keine gespeicherten Eingaben. */ }
      if (draft && String(draft.userId) === String(me.id)) {
        if (draft.edit && draft.ticketId && me.role === 'admin') {
          setHash(draft.ticketId); await openTicket(draft.ticketId);
          if (selected) {
            startEditing(); setForm('edit', draft.edit.values);
            if (draft.edit.previous) {
              savedDraftValues = draft.edit.previous; $('saved-draft-content').replaceChildren(snapshotContent(savedDraftValues)); $('saved-draft').hidden = false;
            }
            if (Number(selected.version) !== Number(draft.edit.base)) $('stale-notice').hidden = false;
            // Die gespeicherten Eingaben basieren weiter auf der ursprünglichen Version.
            selected.version = draft.edit.base;
            message('detail-message', 'Deine ungespeicherten Eingaben wurden nach der Anmeldung wiederhergestellt.');
          }
        } else if (draft.create) {
          setForm('create', draft.create); $('create-dialog').showModal(); $('create-category').focus();
          message('create-message', 'Deine Eingaben wurden nach der Anmeldung wiederhergestellt.', false);
        } else if (draft.ticketId) { setHash(draft.ticketId); await openTicket(draft.ticketId); }
      } else if (hashId()) await openTicket(hashId());
    } catch (error) {
      message('page-message', friendlyError(error), true); text('list-count', 'Anmeldung konnte nicht geprüft werden.');
      const retry = node('button', 'Erneut versuchen'); retry.type = 'button'; retry.addEventListener('click', boot);
      $('page-message').append(document.createTextNode(' '), retry);
    }
  }
  boot();
})();
