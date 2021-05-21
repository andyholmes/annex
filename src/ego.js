// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Repository, SearchModel */

const {GLib, GObject, Gio, Soup} = imports.gi;


/* URIs */
const BASE_URI = 'https://extensions.gnome.org';
const EXTENSION_INFO_URI = `${BASE_URI}/extension-info/`;
const EXTENSION_QUERY_URI = `${BASE_URI}/extension-query/`;
const EXTENSION_DOWNLOAD_URI = `${BASE_URI}/download-extension/`;


/* Directories */
const CACHEDIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'annex']);
const CONFIGDIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'annex']);
const DATADIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'annex']);

for (const dir of [CACHEDIR, CONFIGDIR, DATADIR])
    GLib.mkdir_with_parents(dir, 0o755);


/**
 * Enum for search result order.
 *
 * @readonly
 * @enum {string}
 */
var SortType = {
    DOWNLOADS: 'downloads',
    NAME: 'name',
    POPULARITY: 'popularity',
    RECENT: 'recent',
};


/**
 * An object representing a search result.
 */
var ExtensionInfo = GObject.registerClass({
    GTypeName: 'AnnexExtensionInfo',
    Properties: {
        'creator': GObject.ParamSpec.string(
            'creator',
            'Creator',
            'Creator of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'creator-url': GObject.ParamSpec.string(
            'creator-url',
            'Creator URL',
            'The creator page on e.g.o',
            GObject.ParamFlags.READABLE,
            null
        ),
        'description': GObject.ParamSpec.string(
            'description',
            'Description',
            'Description of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'icon': GObject.ParamSpec.object(
            'icon',
            'Icon',
            'Icon of the extension',
            GObject.ParamFlags.READWRITE,
            Gio.Icon.$gtype
        ),
        'name': GObject.ParamSpec.string(
            'name',
            'Name',
            'Name of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'screenshot': GObject.ParamSpec.object(
            'screenshot',
            'Screenshot',
            'Screenshot of the extension',
            GObject.ParamFlags.READWRITE,
            Gio.File.$gtype
        ),
        'url': GObject.ParamSpec.string(
            'url',
            'URL',
            'URL of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
        'uuid': GObject.ParamSpec.string(
            'uuid',
            'UUID',
            'UUID of the extension',
            GObject.ParamFlags.READWRITE,
            null
        ),
    },
}, class ExtensionInfo extends GObject.Object {
    _init(info = {}) {
        super._init();

        this.update(info);
    }

    get creator_url() {
        if (this.creator === null)
            return null;

        return `${BASE_URI}/accounts/profile/${this.creator}`;
    }

    get icon() {
        if (this._icon === undefined)
            this._icon = new Gio.ThemedIcon({name: 'plugin'});

        return this._icon;
    }

    set icon(icon) {
        if (this.icon !== icon) {
            this._icon = icon;
            this.notify('icon');
        }
    }

    /**
     * Update with new JSON data.
     *
     * @param {Object} properties - An extension info object
     * @param {string} properties.uuid - the UUID
     * @param {string} properties.name - the name
     * @param {string} properties.description - the description
     * @param {string} properties.creator - the creator's username
     * @param {Object} properties.shell_version_map - the version map
     */
    update(properties) {
        // Update native properties
        this.uuid = properties.uuid;
        this.name = properties.name;
        this.description = properties.description;
        this.pk = properties.pk;
        this.url = `${BASE_URI}${properties.link}`;

        this.creator = properties.creator;
        this.shell_version_map = properties.shell_version_map;

        // Query for image data
        const repository = Repository.getDefault();

        if (properties.icon) {
            repository.requestFile(properties.icon).then(file => {
                this.icon = new Gio.FileIcon({file});
            }).catch(logError);
        }

        if (properties.screenshot) {
            repository.requestFile(properties.screenshot).then(file => {
                this.screenshot = file;
            }).catch(logError);
        }
    }
});


/**
 * Repository Singleton
 */
var Repository = GObject.registerClass({
    GTypeName: 'AnnexEgoRepository',
    Properties: {
        'online': GObject.ParamSpec.boolean(
            'online',
            'Online',
            'Whether the repository is available',
            GObject.ParamFlags.READABLE,
            false
        ),
    },
}, class AnnexEgoRepository extends GObject.Object {
    _init() {
        super._init();

        this._extensions = new Map();

        // File Cache
        this._files = new Map();
        this._files.set('/static/images/plugin.png',
            Gio.File.new_for_uri('resource://ca/andyholmes/Annex/icons/ego-plugin.svg'));

        // Network
        this._network = Gio.NetworkMonitor.get_default();
        this._network.connect('notify::connectivity',
            this._onNetworkChanged.bind(this));

        this._session = new Soup.Session({ssl_use_system_ca_file: true});
        Soup.Session.prototype.add_feature.call(this._session,
            new Soup.ProxyResolverDefault());

        this._onNetworkChanged(this._network);
    }

    static getDefault() {
        if (this.__default === undefined)
            this.__default = new Repository();

        return this.__default;
    }

    get online() {
        if (this._online === undefined)
            this._online = false;

        return this._online;
    }

    _onNetworkChanged(network, _pspec) {
        const online = network.connectivity === Gio.NetworkConnectivity.FULL;

        if (this.online !== online) {
            this._online = online;
            this.notify('online');
        }
    }

    _getFile(uri) {
        if (!this._files.has(uri)) {
            const name = GLib.path_get_basename(uri);
            const path = GLib.build_filenamev([CACHEDIR, name]);
            const file = Gio.File.new_for_path(path);

            this._files.set(uri, file);
        }

        return this._files.get(uri);
    }

    _requestBytes(message) {
        return new Promise((resolve, reject) => {
            this._session.queue_message(message, (session, msg) => {
                try {
                    if (msg.status_code !== Soup.KnownStatusCode.OK) {
                        throw GLib.Error.new_literal(Soup.http_error_quark(),
                            msg.status_code, msg.reason_phrase);
                    }

                    resolve(msg.response_body_data);
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _requestFile(message, dest, cancellable = null) {
        const sendTask = new Promise((resolve, reject) => {
            this._session.send_async(
                message,
                cancellable,
                (session, result) => {
                    try {
                        resolve(session.send_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        const replaceTask = new Promise((resolve, reject) => {
            dest.replace_async(
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (file, result) => {
                    try {
                        resolve(file.replace_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        const [source, target] = await Promise.all([sendTask, replaceTask]);

        return new Promise((resolve, reject) => {
            target.splice_async(
                source,
                Gio.OutputStreamSpliceFlags.CLOSE_SOURCE |
                    Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (stream, result) => {
                    try {
                        stream.splice_finish(result);
                        resolve(dest);
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    _requestJson(message) {
        return new Promise((resolve, reject) => {
            this._session.queue_message(message, (session, msg) => {
                try {
                    if (msg.status_code !== Soup.KnownStatusCode.OK) {
                        throw GLib.Error.new_literal(Soup.http_error_quark(),
                            msg.status_code, msg.reason_phrase);
                    }

                    resolve(JSON.parse(msg.response_body.data));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    /**
     * Send a request for a remote file. The result will be cached locally and
     * a GFile for the local copy will be returned.
     *
     * @param {string} path - The path of the remote resource
     * @return {Gio.File} a remote file
     */
    async requestFile(path) {
        const file = this._getFile(path);

        if (!file.query_exists(null)) {
            const message = Soup.Message.new('GET', `${BASE_URI}${path}`);
            await this._requestFile(message, file);
        }

        return file;
    }

    _extensionInfo(uuid) {
        const message = Soup.form_request_new_from_hash('GET',
            EXTENSION_INFO_URI, {uuid});

        return this._requestJson(message);
    }

    _extensionQuery(parameters) {
        const message = Soup.form_request_new_from_hash('GET',
            EXTENSION_QUERY_URI, parameters);

        return this._requestJson(message);
    }

    /**
     * Lookup the extension info for a UUID.
     *
     * @param {string} uuid - an extension UUID
     * @return {ExtensionInfo} extension metadata
     */
    async lookupExtension(uuid) {
        let extension = this._extensions.get(uuid);

        if (extension === undefined) {
            try {
                const properties = await this._extensionInfo(uuid);

                if (properties.hasOwnProperty('uuid')) {
                    extension = new ExtensionInfo(properties);
                    this._extensions.set(extension.uuid, extension);
                }
            } catch (e) {
                // Silence errors
            }
        }

        return extension || null;
    }

    /**
     * Search for extensions matching @parameters.
     *
     * @param {Object} parameters - The query parameters
     * @param {string} parameters.search - The search query
     * @param {string} parameters.sort - The sort type
     * @param {string} parameters.page - The page number
     * @param {string} parameters.shell_version - The GNOME Shell version
     * @return {ExtensionInfo} extension metadata
     */
    async searchExtensions(parameters) {
        for (const [key, value] of Object.entries(parameters))
            parameters[key] = value.toString();

        let results = {
            extensions: [],
            total: 0,
            numpages: 1,
            parameters: parameters,
            error: null,
        };

        try {
            results = await this._extensionQuery(parameters);
            results.parameters = parameters;
            results.error = null;
            results.extensions = results.extensions.map(result => {
                let info = this._extensions.get(result.uuid);

                if (info === undefined) {
                    info = new ExtensionInfo(result);
                    this._extensions.set(info.uuid, info);
                } else {
                    info.update(result);
                }

                return info;
            });
        } catch (e) {
            // Silence errors
            results.error = e;
        }

        return results;
    }
});


/**
 * A GListModel for search results.
 */
var SearchModel = GObject.registerClass({
    GTypeName: 'AnnexSearchModel',
    Implements: [Gio.ListModel],
    Properties: {
        'n-pages': GObject.ParamSpec.uint(
            'n-pages',
            'Pages',
            'Number of pages',
            GObject.ParamFlags.READABLE,
            1, GLib.MAXUINT32,
            1
        ),
        'page': GObject.ParamSpec.uint(
            'page',
            'Page',
            'Current page',
            GObject.ParamFlags.READWRITE,
            1, GLib.MAXUINT32,
            1
        ),
        'query': GObject.ParamSpec.string(
            'query',
            'Query',
            'The seach query',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'shell-version': GObject.ParamSpec.string(
            'shell-version',
            'Shell Version',
            'The supported GNOME Shell version',
            GObject.ParamFlags.READWRITE,
            'all'
        ),
        'sort': GObject.ParamSpec.string(
            'sort',
            'Sort',
            'The sort order',
            GObject.ParamFlags.READWRITE,
            SortType.POPULARITY
        ),
    },
}, class SearchModel extends GObject.Object {
    _init(params = {}) {
        super._init(params);

        this._items = [];
    }

    get n_pages() {
        if (this._n_pages === undefined)
            this._n_pages = 1;

        return this._n_pages;
    }

    get page() {
        if (this._page === undefined || this._page < 1)
            this._page = 1;

        return this._page;
    }

    set page(page) {
        page = Math.max(1, Math.min(page, this.n_pages));

        if (this._page !== page) {
            this._refresh({
                page: page.toString(),
            });
        }
    }

    get query() {
        if (this._query === undefined)
            this._query = '';

        return this._query;
    }

    set query(query) {
        if (this._query !== query) {
            this._refresh({
                search: query,
                page: '1',
            });
        }
    }

    get shell_version() {
        if (this._shell_version === undefined)
            this._shell_version = 'all';

        return this._shell_version;
    }

    set shell_version(version) {
        if (this._shell_version !== version) {
            this._refresh({
                shell_version: version,
                page: '1',
            });
        }
    }

    get sort() {
        if (this._sort === undefined)
            this._sort = SortType.POPULARITY;

        return this._sort;
    }

    set sort(type) {
        if (this._sort !== type) {
            this._refresh({
                sort: type,
                page: '1',
            });
        }
    }

    vfunc_get_item(position) {
        return this._items[position] || null;
    }

    vfunc_get_item_type() {
        return ExtensionInfo.$gtype;
    }

    vfunc_get_n_items() {
        return this._items.length;
    }

    async _refresh(parameters = {}) {
        try {
            this._activeSearch = Object.assign({
                page: this.page.toString(),
                search: this.query,
                shell_version: this.shell_version,
                sort: this.sort,
            }, parameters);

            /* Query e.g.o */
            const repository = Repository.getDefault();
            const results = await repository.searchExtensions(this._activeSearch);

            if (this._activeSearch !== results.parameters)
                return;

            /* Notify on success */
            if (this.page !== results.parameters.page) {
                this._page = results.parameters.page;
                this.notify('page');
            }

            if (this.query !== results.parameters.search) {
                this._query = results.parameters.search;
                this.notify('query');
            }

            if (this.shell_version !== results.parameters.shell_version) {
                this._shell_version = results.parameters.shell_version;
                this.notify('shell-version');
            }

            if (this.sort !== results.parameters.sort) {
                this._sort = results.parameters.sort;
                this.notify('sort');
            }

            if (this.n_pages !== results.numpages) {
                this._n_pages = results.numpages;
                this.notify('n-pages');
            }

            /* Update the list model */
            const removed = this._items.length;
            const added = results.extensions.length;

            this._items = results.extensions;
            this.items_changed(0, removed, added);

            this._activeSearch = null;
        } catch (e) {
            logError(e);
        }
    }
});

