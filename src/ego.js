// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Repository, SearchResults */

const {GLib, GObject, Gio, Soup} = imports.gi;


/* URIs */
const BASE_URI = 'https://extensions.gnome.org';
const EGO_EXTENSION_INFO = `${BASE_URI}/extension-info/`;
const EGO_EXTENSION_QUERY = `${BASE_URI}/extension-query/`;
const EGO_DOWNLOAD_EXTENSION = `${BASE_URI}/download-extension/`;


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
 * Takes an Ego.ExtensionInfo and returns a dictionary of version-info pairs.
 *
 * @param {Ego.ExtensionInfo} info - An extension info
 * @return {Object} dictionary of releases
 */
function parseVersionMap(info) {
    const versions = {};

    for (const [shell, release] of Object.entries(info.shell_version_map)) {
        if (versions[release.version] === undefined) {
            versions[release.version] = {
                pk: release.pk,
                shell_versions: [],
            };
        }

        versions[release.version].shell_versions.push(shell);
    }

    return versions;
}


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
            repository.lookupFile(properties.icon).then(file => {
                this.icon = new Gio.FileIcon({file});
            });
        }

        if (properties.screenshot) {
            repository.lookupFile(properties.screenshot).then(file => {
                this.screenshot = file;
            });
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

    _getFile(path) {
        let file = this._files.get(path);

        if (file === undefined) {
            const filePath = GLib.build_filenamev([CACHEDIR, path]);
            file = Gio.File.new_for_path(filePath);

            this._files.set(path, file);
        }

        return file;
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
        try {
            const directory = dest.get_parent();
            directory.make_directory_with_parents(cancellable);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }

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
     * Download an extension ZIP from EGO.
     *
     * @param {string} uuid - An extension UUID
     * @param {Object} [parameters] - Selection parameters
     * @param {string} [parameters.disable_version_validation] - ??? (eg. 'true')
     * @param {string} [parameters.version_tag] - Release PK (eg. 23066)
     * @param {string} [parameters.shell_version] - Shell version (eg. '40.0')
     * @return {Promise<Gio.File>} the resulting file
     */
    _downloadExtension(uuid, parameters = {}) {
        let path = GLib.build_filenamev([CACHEDIR, 'extensions',
            `${uuid}.shell-extension.zip`]);

        if (parameters.version_tag !== undefined)
            path = GLib.build_filenamev([CACHEDIR, 'extensions',
                parameters.version_tag, `${uuid}.shell-extension.zip`]);

        const dest = Gio.File.new_for_path(path);

        const message = Soup.form_request_new_from_hash('GET',
            `${EGO_DOWNLOAD_EXTENSION}${uuid}.shell-extension.zip`, parameters);

        return this._requestFile(message, dest);
    }

    _extensionInfo(uuid) {
        const message = Soup.form_request_new_from_hash('GET',
            EGO_EXTENSION_INFO, {uuid});

        return this._requestJson(message);
    }

    _extensionQuery(parameters) {
        const message = Soup.form_request_new_from_hash('GET',
            EGO_EXTENSION_QUERY, parameters);

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
     * Get the extension ZIP for version @tag of extension @uuid. If downloaded
     * successfully the file will be cached locally.
     *
     * A Gio.File for the local copy will always be returned, but may not point
     * to an existing file if the download operation fails.
     *
     * @param {string} uuid - The UUID of the extension
     * @param {string} tag - The release PK
     * @return {Gio.File} a locally cached remote file
     */
    async lookupExtensionTag(uuid, tag) {
        const file = this._getFile(`/extensions/${tag}/${uuid}.shell-extension.zip`);

        if (!file.query_exists(null)) {
            try {
                await this._downloadExtension(uuid, {version_tag: `${tag}`});
            } catch (e) {
            }
        }

        return file;
    }

    /**
     * Send a request for a remote file at @path. If successful the result will
     * be cached locally.
     *
     * A GFile for the local copy will always be returned, but may not point to
     * an existing file if the operation fails.
     *
     * @param {string} path - The path of the remote resource
     * @return {Gio.File} a locally cached remote file
     */
    async lookupFile(path) {
        const file = this._getFile(path);

        if (!file.query_exists(null)) {
            try {
                const message = Soup.Message.new('GET', `${BASE_URI}${path}`);
                await this._requestFile(message, file);
            } catch (e) {
                warning(e);
            }
        }

        return file;
    }

    /**
     * Search for extensions matching @parameters.
     *
     * @param {Object} parameters - A dictionary of search parameters
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
 * A GListModel for continuous results.
 */
var SearchResults = GObject.registerClass({
    GTypeName: 'AnnexEgoSearchResults',
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
}, class AnnexEgoSearchResults extends GObject.Object {
    _init(params = {}) {
        super._init();

        this._items = [];
        this._repository = Repository.getDefault();
        this.configure(params);
    }

    get n_pages() {
        if (this._n_pages === undefined)
            this._n_pages = 1;

        return this._n_pages;
    }

    get page() {
        if (this._page === undefined)
            this._page = 1;

        return this._page;
    }

    set page(page) {
        page = Math.max(1, Math.min(page, this.n_pages));

        if (this.page === page)
            return;

        this.configure({page});
    }

    get query() {
        if (this._query === undefined)
            this._query = '';

        return this._query;
    }

    set query(query) {
        if (this.query === query)
            return;

        this.configure({search: query});
    }

    get shell_version() {
        if (this._shell_version === undefined)
            this._shell_version = 'all';

        return this._shell_version;
    }

    set shell_version(version) {
        if (this.shell_version === version)
            return;

        this.configure({shell_version: version});
    }

    get sort() {
        if (this._sort === undefined)
            this._sort = SortType.POPULARITY;

        return this._sort;
    }

    set sort(type) {
        if (this.sort === type)
            return;

        this.configure({sort: type});
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

    /**
     * Configure the result set to match @parameters and reload.
     *
     * @param {Object} [parameters] - A dictionary of search parameters
     * @param {string} [parameters.search] - The search query
     * @param {string} [parameters.sort] - The sort type
     * @param {string} [parameters.page] - The page number
     * @param {string} [parameters.shell_version] - The GNOME Shell version
     */
    configure(parameters = {}) {
        if (parameters.page === undefined) {
            this._n_pages = 1;
            this._page = 0;
        }

        this._removed = this._items.length;
        this._results = [];

        this.loadMore(parameters);
    }

    /**
     * Load more results for the current query, sort and GNOME Shell version.
     *
     * @param {Object} parameters - A dictionary of search parameters
     * @param {string} parameters.search - The search query
     * @param {string} parameters.sort - The sort type
     * @param {string} parameters.page - The page number
     * @param {string} parameters.shell_version - The GNOME Shell version
     */
    async loadMore(parameters = {}) {
        try {
            /* Prepare query */
            parameters = Object.assign({
                page: this.page + 1,
                search: this.query,
                shell_version: this.shell_version,
                sort: this.sort,
            }, parameters);

            parameters.page = Math.min(parameters.page, this.n_pages);

            if (this._results[parameters.page] === undefined)
                this._results[parameters.page] = parameters;
            else
                return;

            /* Query e.g.o */
            const results = await this._repository.searchExtensions(parameters);

            if (this._results[results.parameters.page] === results.parameters)
                this._results[results.parameters.page] = results;
            else
                return;

            /* Notify on success */
            if (this.n_pages !== results.numpages) {
                this._n_pages = results.numpages;
                this.notify('n-pages');
            }

            if (this.page !== parseInt(results.parameters.page)) {
                this._page = parseInt(results.parameters.page);
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

            /* Update the list model */
            const position = (10 * results.parameters.page) - 10;
            const added = results.extensions.length;

            debug(`items-changed(${position}, ${this._removed}, ${added})`);

            this._items.splice(position, this._removed, ...results.extensions);
            this.items_changed(position, this._removed, added);
            this._removed = 0;
        } catch (e) {
            this._results[parameters.page] = e;
        }
    }
});

