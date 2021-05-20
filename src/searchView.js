// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported SearchView */


const {GLib, Gio, GObject, Gtk} = imports.gi;

const Ego = imports.ego;
const Shell = imports.shell;


/**
 * A widget representing an installable extension.
 */
const SearchViewRow = GObject.registerClass({
    GTypeName: 'AnnexSearchViewRow',
    Template: 'resource:///ca/andyholmes/Annex/ui/search-view-row.ui',
    InternalChildren: [
        'iconImage',
        'nameLabel',
        'descriptionLabel',
    ],
    Properties: {
        'info': GObject.ParamSpec.object(
            'info',
            'Result',
            'The search info object',
            GObject.ParamFlags.READWRITE,
            Ego.ExtensionInfo.$gtype
        ),
    },
}, class AnnexSearchViewRow extends Gtk.ListBoxRow {
    _init(info) {
        super._init();

        this.info = info;
    }

    get info() {
        if (this._info === undefined)
            this._info = null;

        return this._info;
    }

    set info(info) {
        if (this.info === info)
            return;

        this._nameLabel.label = info.name;
        this._descriptionLabel.label = info.description.split('\n')[0];

        info.bind_property('icon', this._iconImage, 'gicon',
            GObject.BindingFlags.SYNC_CREATE);

        this._info = info;
        this.notify('info');
    }

    get description() {
        if (this.info === null)
            return null;

        return this.info.description;
    }

    get name() {
        if (this.info === null)
            return null;

        return this.info.name;
    }

    get uuid() {
        if (this.info === null)
            return null;

        return this.info.uuid;
    }
});


/**
 * A widget for displaying the search results of a query.
 */
var SearchView = GObject.registerClass({
    GTypeName: 'AnnexSearchView',
    Template: 'resource:///ca/andyholmes/Annex/ui/search-view.ui',
    InternalChildren: [
        'searchPager',
        'searchResults',
        'searchSort',
    ],
    Properties: {}, // model
    Signals: {
        'extension-selected': {
            param_types: [GObject.TYPE_STRING],
        },
    },
}, class AnnexSearchView extends Gtk.Box {
    _init(params = {}) {
        super._init(params);

        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('search', actionGroup);

        // GSettings
        this.settings = new Gio.Settings({
            schema_id: 'ca.andyholmes.Annex',
        });

        this.settings.connect('changed::version-filter',
            this._onVersionFilterChanged.bind(this));

        // Search model
        this._model = new Ego.SearchModel();

        this._model.connect('items-changed',
            this._onItemsChanged.bind(this));

        this._searchResults.bind_model(this._model,
            this._createRow.bind(this));

        const sortAction = new Gio.PropertyAction({
            name: 'sort',
            object: this._model,
            property_name: 'sort',
        });
        actionGroup.add_action(sortAction);

        this._searchSort.active_id = this._model.sort;
        this._searchSort.bind_property('active-id', this._model, 'sort',
            GObject.BindingFlags.BIDIRECTIONAL);

        // Page Actions
        this._search = new Gio.SimpleAction({
            name: 'search',
            parameter_type: new GLib.VariantType('s'),
            enabled: true,
        });
        this._search.connect('activate', this._searchAction.bind(this));
        actionGroup.add_action(this._search);

        this._nextPage = new Gio.SimpleAction({
            name: 'next-page',
            enabled: false,
        });
        this._nextPage.connect('activate', this._switchPage.bind(this));
        actionGroup.add_action(this._nextPage);

        this._prevPage = new Gio.SimpleAction({
            name: 'prev-page',
            enabled: false,
        });
        this._prevPage.connect('activate', this._switchPage.bind(this));
        actionGroup.add_action(this._prevPage);

        this._onVersionFilterChanged(this.settings, 'version-filter');
    }

    _onItemsChanged(_model, _position, _removed, _added) {
        const {page, n_pages} = this._model;

        this._prevPage.enabled = page > 1;
        this._nextPage.enabled = page < n_pages;
    }

    _onRowActivated(box, row) {
        this.emit('extension-selected', row.uuid);
    }

    _onSearchChanged(entry) {
        this._model.query = entry.get_text();
    }

    _onVersionFilterChanged(settings, key) {
        const manager = Shell.ExtensionManager.getDefault();

        if (settings.get_boolean(key))
            this._model.shell_version = manager.shell_version;
        else
            this._model.shell_version = 'all';
    }

    _createRow(extension) {
        return new SearchViewRow(extension);
    }

    _searchAction(_action, parameter) {
        try {
            this._model.query = parameter.get_string()[0];
        } catch (e) {
            logError(e);
        }
    }

    _switchPage(action, _parameter) {
        if (action === this._prevPage)
            this._model.page--;
        else
            this._model.page++;

        this._prevPage.enabled = false;
        this._nextPage.enabled = false;
    }
});

