// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExploreView */


const {Gio, GObject, Gtk} = imports.gi;

const Ego = imports.ego;
const Shell = imports.shell;

const SECTION_LIMIT = 6;


/**
 * A widget representing an installable extension.
 */
const ExploreViewItem = GObject.registerClass({
    GTypeName: 'AnnexExploreViewItem',
    Template: 'resource:///ca/andyholmes/Annex/ui/explore-view-item.ui',
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
}, class ExploreViewItem extends Gtk.Frame {
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
 * A widget for displaying the top results of several categories.
 */
var ExploreView = GObject.registerClass({
    GTypeName: 'AnnexExploreView',
    Template: 'resource:///ca/andyholmes/Annex/ui/explore-view.ui',
    InternalChildren: [
        'popularResults',
        'recentResults',
    ],
    Signals: {
        'extension-selected': {
            param_types: [GObject.TYPE_STRING],
        },
    },
}, class AnnexExploreView extends Gtk.Box {
    _init() {
        super._init();

        // GSettings
        this.settings = new Gio.Settings({
            schema_id: 'ca.andyholmes.Annex',
        });

        this.settings.connect('changed::version-filter',
            this._onVersionFilterChanged.bind(this));

        this._onVersionFilterChanged(this.settings, 'version-filter');
    }

    async _query(category) {
        try {
            /* Query e.g.o */
            const repository = Ego.Repository.getDefault();
            const results = await repository.searchExtensions({
                page: 1,
                search: '',
                shell_version: this._version,
                sort: category,
            });

            const limit = Math.min(SECTION_LIMIT, results.total);

            return results.extensions.splice(0, limit);
        } catch (e) {
            logError(e);
            return [];
        }
    }

    async _updatePopular() {
        try {
            const results = await this._query(Ego.SortType.POPULARITY);
            let item;

            while ((item = this._popularResults.get_first_child()))
                this._popularResults.remove(item);

            for (const extension of results) {
                item = new ExploreViewItem(extension);
                this._popularResults.insert(item, -1);
            }
        } catch (e) {
            logError(e);
        }
    }

    async _updateRecent() {
        try {
            const results = await this._query(Ego.SortType.RECENT);
            let item;

            while ((item = this._recentResults.get_first_child()))
                this._recentResults.remove(item);

            for (const extension of results) {
                item = new ExploreViewItem(extension);
                this._recentResults.insert(item, -1);
            }
        } catch (e) {
            logError(e);
        }
    }

    _onChildActivated(_box, item) {
        this.emit('extension-selected', item.child.uuid);
    }

    _onVersionFilterChanged(settings, key) {
        const manager = Shell.ExtensionManager.getDefault();

        if (settings.get_boolean(key))
            this._version = manager.shell_version;
        else
            this._version = 'all';

        this._updatePopular();
        this._updateRecent();
    }

    _createItem(extension) {
        return new ExploreViewItem(extension);
    }
});

