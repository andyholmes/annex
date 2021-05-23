// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExploreView */


const {Gio, GLib, GObject, Gtk} = imports.gi;

const Ego = imports.ego;
const Shell = imports.shell;

const SECTION_LIMIT = 9;

/**
 * An extension widget for listboxes.
 */
const ExtensionViewRow = GObject.registerClass({
    GTypeName: 'AnnexExploreViewRow',
    Template: 'resource:///ca/andyholmes/Annex/ui/explore-view-row.ui',
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
}, class AnnexExploreViewRow extends Gtk.ListBoxRow {
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

        info.bind_property('icon', this._iconImage, 'gicon',
            GObject.BindingFlags.SYNC_CREATE);
        info.bind_property('name', this._nameLabel, 'label',
            GObject.BindingFlags.SYNC_CREATE);
        info.bind_property('description', this._descriptionLabel, 'label',
            GObject.BindingFlags.SYNC_CREATE);

        this._info = info;
        this.notify('info');
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
 * An extension widget for flowboxes.
 */
const ExtensionViewTile = GObject.registerClass({
    GTypeName: 'AnnexExploreViewTile',
    Template: 'resource:///ca/andyholmes/Annex/ui/explore-view-tile.ui',
    InternalChildren: [
        'iconImage',
        'nameLabel',
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
}, class AnnexExploreViewTile extends Gtk.Frame {
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

        info.bind_property('icon', this._iconImage, 'gicon',
            GObject.BindingFlags.SYNC_CREATE);
        info.bind_property('name', this._nameLabel, 'label',
            GObject.BindingFlags.SYNC_CREATE);

        this._info = info;
        this.notify('info');
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
 * A widget for displaying the top results of several categories.
 */
var ExploreView = GObject.registerClass({
    GTypeName: 'AnnexExploreView',
    Template: 'resource:///ca/andyholmes/Annex/ui/explore-view.ui',
    InternalChildren: [
        'popularResults',
        'popularStack',
        'popularStatus',
        'recentResults',
        'recentStack',
        'recentStatus',
        'searchBar',
        'searchEntry',
        'searchResults',
        'searchScroll',
        'searchSort',
        'searchStatus',
        'stack',
    ],
    Properties: {
        'search-mode-enabled': GObject.ParamSpec.boolean(
            'search-mode-enabled',
            'Search Mode Enabled',
            'Whether the search bar is revealed',
            GObject.ParamFlags.READWRITE,
            false
        ),
    },
    Signals: {
        'extension-selected': {
            param_types: [GObject.TYPE_STRING],
        },
    },
}, class AnnexExploreView extends Gtk.Box {
    _init() {
        super._init();

        this.bind_property('search-mode-enabled', this._searchBar,
            'search-mode-enabled', GObject.BindingFlags.BIDIRECTIONAL |
            GObject.BindingFlags.SYNC_CREATE);

        // GSettings
        this.settings = new Gio.Settings({
            schema_id: 'ca.andyholmes.Annex',
        });

        this.settings.connect('changed::version-filter',
            this._onVersionFilterChanged.bind(this));

        // Actions
        const actionGroup = new Gio.SimpleActionGroup();
        this.insert_action_group('search', actionGroup);

        // Repository
        this._repository = Ego.Repository.getDefault();

        // Search model
        this._model = new Ego.SearchResults();

        this._searchResults.bind_model(this._model,
            this._createRow.bind(this));

        const sortAction = new Gio.PropertyAction({
            name: 'sort',
            object: this._model,
            property_name: 'sort',
        });
        actionGroup.add_action(sortAction);

        this._searchScroll.vadjustment.connect('value-changed',
            this._maybeLoadMore.bind(this));

        this._searchSort.active_id = this._model.sort;
        this._searchSort.connect('notify::active-id',
            this._onSortChanged.bind(this));

        // Search Actions
        this._searchBar.connect_entry(this._searchEntry);

        const browseAction = new Gio.SimpleAction({
            name: 'browse',
            parameter_type: new GLib.VariantType('s'),
            enabled: true,
        });
        browseAction.connect('activate',
            this._onBrowseActivated.bind(this));
        actionGroup.add_action(browseAction);

        this._onVersionFilterChanged(this.settings, 'version-filter');
    }

    /*
     * Explore
     */
    _createTile(extension) {
        return new ExtensionViewTile(extension);
    }

    async _query(category) {
        /* Query e.g.o */
        const results = await this._repository.searchExtensions({
            page: 1,
            search: '',
            shell_version: this._version,
            sort: category,
        });

        /* Amend the results */
        const limit = Math.min(SECTION_LIMIT, results.total);
        results.extensions = results.extensions.slice(0, limit);
        results.numpages = 1;
        results.total = limit;

        return results;
    }

    async _updatePopular() {
        try {
            let item;

            // Display loading and empty the results box
            this._popularStatus.label = _('Loading…');
            this._popularStack.visible_child_name = 'status';

            while ((item = this._popularResults.get_first_child()))
                this._popularResults.remove(item);

            // Query EGO
            const results = await this._query(Ego.SortType.POPULARITY);

            // Show the results or error
            if (results.extensions.length > 0) {
                for (const extension of results.extensions) {
                    item = new ExtensionViewTile(extension);
                    this._popularResults.insert(item, -1);
                }

                this._popularStack.visible_child_name = 'results';
                this._popularStatus.label = null;
            } else {
                this._popularStatus.label = _('No results');
                this._popularStack.visible_child_name = 'status';
            }
        } catch (e) {
            logError(e);
        }
    }

    async _updateRecent() {
        try {
            let item;

            // Display loading and empty the results box
            this._recentStatus.label = _('Loading…');
            this._recentStack.visible_child_name = 'status';

            while ((item = this._recentResults.get_first_child()))
                this._recentResults.remove(item);

            // Query EGO
            const results = await this._query(Ego.SortType.RECENT);

            // Show the results or error
            if (results.extensions.length === 0) {
                this._recentStatus.label = _('No results');
                this._recentStack.visible_child_name = 'status';
            } else {
                for (const extension of results.extensions) {
                    item = new ExtensionViewTile(extension);
                    this._recentResults.insert(item, -1);
                }

                this._recentStack.visible_child_name = 'results';
                this._recentStatus.label = null;
            }
        } catch (e) {
            logError(e);
        }
    }

    _onChildActivated(_box, item) {
        this.emit('extension-selected', item.child.uuid);
    }

    /*
     * Search
     */
    _createRow(extension) {
        return new ExtensionViewRow(extension);
    }

    _maybeLoadMore(adjustment) {
        const {value, page_size, upper} = adjustment;

        // If there's less than two pages buffered, start loading more
        if (upper - (value + page_size) < (3 * page_size))
            this._model.loadMore();
    }

    _showSearch() {
        this._searchBar.search_mode_enabled = true;
        this._searchScroll.vadjustment.value = 0.0;
        this._stack.visible_child_name = 'search';
    }

    _onRowActivated(_box, row) {
        this.emit('extension-selected', row.uuid);
    }

    _onBrowseActivated(_action, parameter) {
        const sort = parameter.get_string()[0];

        this._searchEntry.text = '';
        this._searchSort.active_id = sort;
        this._showSearch();
    }

    _onSearchActivate(_entry) {
        this._showSearch();
    }

    _onSearchChanged(_entry) {
        this._model.query = this._searchEntry.text;
        this._showSearch();
    }

    _onSearchModeChanged(_bar, _pspec) {
        if (!this._searchBar.search_mode_enabled) {
            this._stack.visible_child_name = 'welcome';
            this._searchScroll.vadjustment.value = 0.0;
        }
    }

    _onSortChanged(_combo, _pspec) {
        this._model.sort = this._searchSort.active_id;
        this._showSearch();
    }

    _onVersionFilterChanged(settings, key) {
        const manager = Shell.ExtensionManager.getDefault();

        if (settings.get_boolean(key)) {
            this._model.shell_version = manager.shell_version;
            this._version = manager.shell_version;
        } else {
            this._model.shell_version = 'all';
            this._version = 'all';
        }

        this._searchScroll.vadjustment.value = 0.0;
        this._updatePopular();
        this._updateRecent();
    }
});

