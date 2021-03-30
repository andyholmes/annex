// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported ExploreView */


const {Gio, GObject, Gtk} = imports.gi;
const {EGO, ExtensionInfo, SortType} = imports.ego;
const {ExtensionManager} = imports.extensionSystem;

const SECTION_LIMIT = 6;


const ExploreViewItem = GObject.registerClass({
    GTypeName: 'AnnexExploreViewItem',
    Template: 'resource:///ca/andyholmes/Annex/ui/explore-view-item.ui',
    InternalChildren: [
        'iconImage',
        'nameLabel',
        'descriptionLabel',
    ],
}, class ExploreViewItem extends Gtk.Frame {
    _init(extension) {
        super._init();

        this.extension = extension;
    }

    get extension() {
        if (this._extension === undefined)
            this._extension = null;

        return this._extension;
    }

    set extension(extension) {
        if (extension) {
            this._extension = extension;

            this._nameLabel.label = this.name;
            this._descriptionLabel.label = this.description.split('\n')[0];

            extension.bind_property('icon', this._iconImage, 'gicon',
                GObject.BindingFlags.SYNC_CREATE);
        }
    }

    get description() {
        return this._extension.description;
    }

    get name() {
        return this._extension.name;
    }

    get uuid() {
        return this._extension.uuid;
    }
});


var ExploreView = GObject.registerClass({
    GTypeName: 'AnnexExploreView',
    Template: 'resource:///ca/andyholmes/Annex/ui/explore-view.ui',
    InternalChildren: [
        'popularResults',
        'recentResults',
    ],
    Signals: {
        'extension-selected': {
            param_types: [ExtensionInfo.$gtype],
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
            const ego = EGO.getDefault();
            const results = await ego.searchExtensions({
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
            const results = await this._query(SortType.POPULARITY);
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
            const results = await this._query(SortType.RECENT);
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

    _onChildActivated(box, item) {
        this.emit('extension-selected', item.child.extension);
    }

    _onVersionFilterChanged(settings, key) {
        this._version = 'all';

        if (settings.get_boolean(key)) {
            const manager = ExtensionManager.getDefault();
            this._version = manager.shell_version;
        } else {
            this._version = 'all';
        }

        this._updatePopular();
        this._updateRecent();
    }

    _createItem(extension) {
        return new ExploreViewItem(extension);
    }
});

