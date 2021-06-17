// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2021 Andy Holmes <andrew.g.r.holmes@gmail.com>

/* exported Repository, SearchResults, ShellVersion, SortType, UpdateType */

const {GLib, GObject, Gio, Soup} = imports.gi;


/* URIs */
const BASE_URI = 'https://extensions.gnome.org';
const EGO_EXTENSION_INFO = `${BASE_URI}/extension-info/`;
const EGO_EXTENSION_QUERY = `${BASE_URI}/extension-query/`;
const EGO_DOWNLOAD_EXTENSION = `${BASE_URI}/download-extension/`;
const EGO_UPDATE_INFO = `${BASE_URI}/update-info/`;


/* Directories */
const CACHEDIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'annex']);
const CONFIGDIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'annex']);
const DATADIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'annex']);

for (const dir of [CACHEDIR, CONFIGDIR, DATADIR])
    GLib.mkdir_with_parents(dir, 0o755);


/**
 * Enumeration of GNOME Shell versions.
 *
 * @readonly
 * @enum {string}
 */
var ShellVersion = {
    ALL: 'all',
    3.38: '3.38',
    40: '40',
};

/**
 * Enumeration of search result order.
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
 * Enumeration of extension update types.
 *
 * @readonly
 * @enum {string}
 */
var UpdateType = {
    NONE: 'none',
    BLACKLIST: 'blacklist',
    DOWNGRADE: 'downgrade',
    NEW: 'new',
    UPGRADE: 'upgrade',
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
    _init(properties = {}) {
        super._init();

        this.updateState(properties);
    }

    get creator_markup() {
        if (this.creator === null)
            return null;

        return `<a href="${this.creator_url}">${this.creator}</a>`;
    }

    get creator_url() {
        if (this.creator === null)
            return null;

        return `${BASE_URI}/accounts/profile/${this.creator}`;
    }

    get icon() {
        if (this._icon === undefined || this._icon === null)
            this._icon = new Gio.ThemedIcon({name: 'ego-plugin'});

        return this._icon;
    }

    set icon(icon) {
        if (this.icon === icon)
            return;

        this._icon = icon;
        this.notify('icon');
    }

    /**
     * Get the latest version.
     *
     * @param {string} shell_version - the target Shell version
     * @return {number} the latest supported version
     */
    getLatestVersion(shell_version = '') {
        const [shellMajor, shellMinor] = shell_version.split('.');
        const versions = [];

        for (const [shell, release] of Object.entries(this.shell_version_map)) {
            const [major, minor] = shell.split('.');

            if (!shellMajor)
                versions[release.version] = release;
            else if (major === shellMajor && minor === shellMinor)
                versions[release.version] = release;
            else if (major === shellMajor && major >= 40)
                versions[release.version] = release;
        }

        return versions.pop();
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
    updateState(properties) {
        this._json = properties;

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
                this._icon = new Gio.FileIcon({file});
                this.notify('icon');
            }).catch(warning);
        }

        if (properties.screenshot) {
            repository.lookupFile(properties.screenshot).then(file => {
                this.screenshot = file;
            });
        }
    }

    toJson() {
        return this._json;
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

        await new Promise((resolve, reject) => {
            target.splice_async(
                source,
                Gio.OutputStreamSpliceFlags.CLOSE_SOURCE |
                    Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (stream, result) => {
                    try {
                        resolve(stream.splice_finish(result));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        return dest;
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
        debug(`${uuid}, ${JSON.stringify(parameters)}`);

        const message = Soup.form_request_new_from_hash('GET',
            `${EGO_DOWNLOAD_EXTENSION}${uuid}.shell-extension.zip`, parameters);

        let path = GLib.build_filenamev([CACHEDIR, 'download-extension',
            `${uuid}.shell-extension.zip`]);

        if (parameters.version_tag !== undefined) {
            path = GLib.build_filenamev([CACHEDIR, 'download-extension',
                `${uuid}.${parameters.version_tag}.shell-extension.zip`]);
        }

        const dest = Gio.File.new_for_path(path);

        return this._requestFile(message, dest);
    }

    /**
     * Query EGO for the extension @uuid.
     *
     * @param {string} uuid - an extension UUID
     * @return {Object} extension metadata
     */
    _extensionInfo(uuid) {
        debug(`${uuid}`);

        const message = Soup.form_request_new_from_hash('GET',
            EGO_EXTENSION_INFO, {uuid});

        return this._requestJson(message);
    }

    /**
     * Query EGO for extensions matching @parameters.
     *
     * @param {Object} parameters - A dictionary of search parameters
     * @param {string} parameters.search - The search query
     * @param {string} parameters.sort - The sort type
     * @param {string} parameters.page - The page number
     * @param {string} parameters.shell_version - The GNOME Shell version
     * @return {Object} extension metadata
     */
    _extensionQuery(parameters) {
        debug(`${JSON.stringify(parameters)}`);

        const message = Soup.form_request_new_from_hash('GET',
            EGO_EXTENSION_QUERY, parameters);

        return this._requestJson(message);
    }

    /**
     * Query EGO for the members of @installed that have available updates.
     *
     * @param {Object} parameters - A dictionary of search parameters
     * @param {string} parameters.disable_version_validation - Strict versioning
     * @param {string} parameters.shell_version - The GNOME Shell version
     * @param {Object} installed - A dictionary of UUID-Properties entries
     * @return {Object} a dictionary of UUID-UpdateType pairs
     */
    _updateInfo(parameters, installed) {
        debug(`${JSON.stringify(parameters)}, ${JSON.stringify(installed)}`);

        /* Prepare message */
        const uri = Soup.URI.new(EGO_UPDATE_INFO);
        uri.set_query_from_form(parameters);

        const message = Soup.Message.new_from_uri('POST', uri);
        message.set_request('application/json', Soup.MemoryUse.COPY,
            JSON.stringify(installed));

        return this._requestJson(message);
    }

    /**
     * Check if the extension @uuid has an update for @version.
     *
     * @param {string} uuid - an extension UUID
     * @param {string} version - an extension version
     * @param {string} shell_version - an GNOME Shell version
     * @return {boolean} %true if update available
     */
    async checkUpdate(uuid, version, shell_version = '') {
        try {
            const info = await this.lookup(uuid);
            const latest = info.getLatestVersion(shell_version);

            if (latest === undefined || latest.version === version)
                return UpdateType.NONE;
            else if (latest.version > version)
                return UpdateType.UPGRADE;
            else if (latest.version < version)
                return UpdateType.DOWNGRADE;
        } catch (e) {
            warning(e, `${e.code}`);
        }

        return false;
    }

    /**
     * Lookup the extension info for a UUID.
     *
     * @param {string} uuid - an extension UUID
     * @return {ExtensionInfo} extension metadata
     */
    async lookup(uuid) {
        let extension = this._extensions.get(uuid);

        if (extension === undefined) {
            try {
                const properties = await this._extensionInfo(uuid);

                if (properties.hasOwnProperty('uuid')) {
                    extension = new ExtensionInfo(properties);
                    this._extensions.set(extension.uuid, extension);
                }
            } catch (e) {
                debug(e);
            }
        }

        return extension || null;
    }

    /**
     * Get the extension ZIP identified by @tag for @uuid. If downloaded
     * successfully the file will be cached locally.
     *
     * A Gio.File for the local copy will always be returned, but may not point
     * to an existing file if the download operation fails.
     *
     * @param {string} uuid - The UUID of the extension
     * @param {string} tag - The release PK
     * @return {Gio.File} a locally cached remote file
     */
    async lookupExtension(uuid, tag) {
        const file = this._getFile(`/download-extension/${uuid}.${tag}.shell-extension.zip`);

        if (!file.query_exists(null)) {
            try {
                await this._downloadExtension(uuid, {
                    disable_version_validation: `${true}`,
                    version_tag: `${tag}`,
                });
            } catch (e) {
                warning(e);
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
    async query(parameters) {
        let results = {
            extensions: [],
            total: 0,
            numpages: 1,
        };

        try {
            for (const [key, value] of Object.entries(parameters))
                parameters[key] = value.toString();

            results = await this._extensionQuery(parameters);
            results.parameters = parameters;
            results.error = null;
            results.extensions = results.extensions.map(properties => {
                let info = this._extensions.get(properties.uuid);

                if (info === undefined) {
                    info = new ExtensionInfo(properties);
                    this._extensions.set(info.uuid, info);
                } else {
                    info.updateState(properties);
                }

                return info;
            });
        } catch (e) {
            results.parameters = parameters;
            results.error = e;
        }

        return results;
    }
});


/**
 * A GListModel for search results, controlled by the `SearchMode.query`,
 * `SearchModel.shell-version` and `SearchModel.sort` properties.
 *
 * Progressive loading for continuous views should call `loadMore()` to add
 * more items to the model. Paged loading should use the `page` property to
 * replace the items in the model.
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
        'search': GObject.ParamSpec.string(
            'search',
            'Query',
            'The search query',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'shell-version': GObject.ParamSpec.string(
            'shell-version',
            'Shell Version',
            'The supported GNOME Shell version',
            GObject.ParamFlags.READWRITE,
            ShellVersion.ALL
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

    get search() {
        if (this._search === undefined)
            this._search = '';

        return this._search;
    }

    set search(search) {
        if (this.search === search)
            return;

        this.configure({search});
    }

    get shell_version() {
        if (this._shell_version === undefined)
            this._shell_version = ShellVersion.ALL;

        return this._shell_version;
    }

    set shell_version(shell_version) {
        if (this.shell_version === shell_version)
            return;

        this.configure({shell_version});
    }

    get sort() {
        if (this._sort === undefined)
            this._sort = SortType.POPULARITY;

        return this._sort;
    }

    set sort(sort) {
        if (this.sort === sort)
            return;

        this.configure({sort});
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
                search: this.search,
                shell_version: this.shell_version,
                sort: this.sort,
            }, parameters);

            parameters.page = Math.min(parameters.page, this.n_pages);

            if (this._results[parameters.page] === undefined)
                this._results[parameters.page] = parameters;
            else
                return;

            /* Query e.g.o */
            const results = await this._repository.query(parameters);

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

            if (this.search !== results.parameters.search) {
                this._search = results.parameters.search;
                this.notify('search');
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
            debug(e);
            this._results[parameters.page] = e;
        }
    }
});

